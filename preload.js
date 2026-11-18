// Pont securise entre le renderer et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // fenetre
  minimize:  () => ipcRenderer.invoke('win:minimize'),
  close:     () => ipcRenderer.invoke('win:close'),
  togglePin: () => ipcRenderer.invoke('win:toggle-pin'),
  autosize:  (h) => ipcRenderer.invoke('win:autosize', h),

  // sessions Claude
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  openEditor:   (dir) => ipcRenderer.invoke('app:open-editor', dir),

  // git
  pickRepo:    () => ipcRenderer.invoke('git:pick-repo'),
  gitData:     (repo) => ipcRenderer.invoke('git:data', repo),
  gitCheckout: (repo, branch) => ipcRenderer.invoke('git:checkout', repo, branch)
});
