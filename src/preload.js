const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setBadge: (count) => ipcRenderer.send('set-badge', count),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  platform: process.platform
});
