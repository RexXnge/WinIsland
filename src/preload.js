const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('island', {
  onTrack:      (cb) => ipcRenderer.on('track',        (_e, d) => cb(d)),
  onSys:        (cb) => ipcRenderer.on('sys',          (_e, d) => cb(d)),
  onBrightness: (cb) => ipcRenderer.on('brightness',   (_e, v) => cb(v)),
  onHoverChange:(cb) => ipcRenderer.on('hover-change', (_e, v) => cb(v)),
  sendControl:  (cmd) => ipcRenderer.send('control', cmd),
  dragStart: (offX, offY) => ipcRenderer.send('drag-start', { offX, offY }),
  dragEnd:   ()           => ipcRenderer.send('drag-end'),
});
