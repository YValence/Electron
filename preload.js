// Pont securise entre le renderer et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // fenetre
  minimize:  () => ipcRenderer.invoke('win:minimize'),
  close:     () => ipcRenderer.invoke('win:close'),
  togglePin: () => ipcRenderer.invoke('win:toggle-pin'),

  // sessions Claude
  listSessions: () => ipcRenderer.invoke('sessions:list'),

  // git
  pickRepo:    () => ipcRenderer.invoke('git:pick-repo'),
  gitData:     (repo) => ipcRenderer.invoke('git:data', repo),
  gitCheckout: (repo, branch) => ipcRenderer.invoke('git:checkout', repo, branch)
});
