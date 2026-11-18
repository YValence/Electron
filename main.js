// Cockpit — processus principal Electron
// Fenetre flottante toujours au-dessus + ponts IPC vers les sessions Claude et Git.
const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const sessions = require('./lib/sessions');
const git = require('./lib/git');

let win = null;

app.setName('Cockpit');

function createWindow() {
  win = new BrowserWindow({
    title: 'Cockpit',
    width: 480,
    height: 320,
    minWidth: 360,
    minHeight: 140,
    frame: false,              // on dessine notre propre barre de titre
    transparent: true,
    resizable: true,
    alwaysOnTop: true,         // "epingle par-dessus" par defaut
    skipTaskbar: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- Controles fenetre ----------
ipcMain.handle('win:minimize', () => win && win.minimize());
ipcMain.handle('win:close', () => win && win.close());
ipcMain.handle('win:toggle-pin', () => {
  if (!win) return false;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next, 'floating');
  return next;
});

// Hauteur de la fenetre ajustee au contenu (largeur conservee)
ipcMain.handle('win:autosize', (_e, h) => {
  if (!win) return;
  const [w, cur] = win.getContentSize();
  const screenH = screen.getPrimaryDisplay().workAreaSize.height;
  const target = Math.max(140, Math.min(Math.round(h), Math.round(screenH * 0.9)));
  if (Math.abs(target - cur) > 2) win.setContentSize(w, target, false);
});

// ---------- Sessions Claude ----------
ipcMain.handle('sessions:list', async () => {
  try {
    return { ok: true, agents: await sessions.listAgents() };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err), agents: [] };
  }
});

// ---------- Git ----------
ipcMain.handle('git:pick-repo', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choisir un depot Git',
    properties: ['openDirectory']
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const repo = res.filePaths[0];
  if (!(await git.isRepo(repo))) {
    return { ok: false, error: "Ce dossier n'est pas un depot Git." };
  }
  return { ok: true, repo };
});

ipcMain.handle('git:data', async (_e, repo) => {
  try {
    return { ok: true, ...(await git.graph(repo)) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('git:checkout', async (_e, repo, branch) => {
  try {
    await git.checkout(repo, branch);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});
