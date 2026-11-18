// Cockpit — processus principal Electron
// Fenetre flottante toujours au-dessus + ponts IPC vers les sessions Claude et Git.
const { app, BrowserWindow, ipcMain, dialog, screen, shell, clipboard } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const sessions = require('./lib/sessions');
const git = require('./lib/git');

let win = null;
let drawerMode = false;       // true = la fenetre est en "tiroir" collee au bord droit

app.setName('Cockpit');

// Zone d'ecran utilisable (hors barre des taches).
function workArea() { return screen.getPrimaryDisplay().workArea; }

// En mode tiroir : colle le bord droit de la fenetre au bord droit de l'ecran,
// centree verticalement. (L'animation de glissement, elle, se fait en CSS.)
function placeDrawer() {
  if (!win || !drawerMode) return;
  const wa = workArea();
  const [w, h] = win.getSize();
  const x = wa.x + wa.width - w;                         // bords droits alignes
  const y = Math.round(wa.y + (wa.height - h) / 2);      // centre vertical
  win.setPosition(x, Math.max(wa.y, y), false);
}

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
  const screenH = workArea().height;
  // En tiroir, une hauteur mini plus grande pour que la languette soit facile a viser.
  const minH = drawerMode ? 360 : 140;
  const target = Math.max(minH, Math.min(Math.round(h), Math.round(screenH * 0.9)));
  if (Math.abs(target - cur) > 2) win.setContentSize(w, target, false);
  if (drawerMode) placeDrawer();   // on reste colle au bord droit apres redimensionnement
});

// ---------- Mode tiroir ----------
// Rend la fenetre "transparente aux clics" (on clique a travers) ou non.
// { forward: true } => on recoit quand meme les mouvements de souris pour detecter le survol.
ipcMain.handle('drawer:click-through', (_e, ignore) => {
  if (!win) return;
  win.setIgnoreMouseEvents(!!ignore, { forward: true });
});

// Active / desactive le mode tiroir et replace la fenetre en consequence.
ipcMain.handle('drawer:set-mode', (_e, on) => {
  if (!win) return { drawer: false };
  drawerMode = !!on;
  if (drawerMode) {
    win.setIgnoreMouseEvents(true, { forward: true });   // ferme par defaut = clic a travers
    placeDrawer();
  } else {
    win.setIgnoreMouseEvents(false);                     // fenetre classique = clics normaux
    const wa = workArea();
    const [w, h] = win.getSize();
    win.setPosition(Math.round(wa.x + (wa.width - w) / 2),
                    Math.round(wa.y + (wa.height - h) / 2), false);
  }
  return { drawer: drawerMode };
});

// ---------- Ouvrir le projet dans VS Code ----------
// Cockpit ne peut pas repondre a la place de l'agent (il ne fait que lire les fichiers) :
// ce bouton amene l'utilisateur la ou il repond vraiment. Si "code" n'existe pas,
// on ouvre au moins le dossier dans l'explorateur.
ipcMain.handle('app:open-editor', async (_e, dir) => {
  if (!dir) return { ok: false };
  try {
    const cmd = process.platform === 'win32' ? 'code.cmd' : 'code';
    const child = spawn(cmd, [dir], { detached: true, stdio: 'ignore', shell: true });
    child.on('error', () => shell.openPath(dir));
    child.unref();
    return { ok: true };
  } catch {
    shell.openPath(dir);
    return { ok: true };
  }
});

// Copie un texte dans le presse-papier (pour coller une question / une commande)
ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text || ''));
  return { ok: true };
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
  const picked = res.filePaths[0];
  const repo = await git.repoRoot(picked);   // on remonte a la racine du depot
  if (!repo) {
    return { ok: false, error: "Ce dossier n'est pas un depot Git." };
  }
  return { ok: true, repo };
});

// Liste des depots detectes a partir des dossiers fournis (cwd des sessions + ajouts)
ipcMain.handle('git:repos', async (_e, dirs) => {
  try {
    return { ok: true, repos: await git.detectRepos(dirs) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err), repos: [] };
  }
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
