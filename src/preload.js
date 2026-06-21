const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('island', {
  onTrack: (cb) => ipcRenderer.on('track', (_e, data) => cb(data)),
  onSys: (cb) => ipcRenderer.on('sys', (_e, data) => cb(data)),
  onBrightness: (cb) => ipcRenderer.on('brightness', (_e, v) => cb(v)),
  sendControl: (cmdObj) => ipcRenderer.send('control', cmdObj),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore)
});
