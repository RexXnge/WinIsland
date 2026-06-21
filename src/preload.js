const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('island', {
  onTrack:      (cb) => ipcRenderer.on('track',        (_e, d) => cb(d)),
  onSys:        (cb) => ipcRenderer.on('sys',          (_e, d) => cb(d)),
  onBrightness: (cb) => ipcRenderer.on('brightness',   (_e, v) => cb(v)),
  onHoverChange:(cb) => ipcRenderer.on('hover-change', (_e, v) => cb(v)),
  onWeather:    (cb) => ipcRenderer.on('weather',      (_e, d) => cb(d)),
  onForeground: (cb) => ipcRenderer.on('foreground',   (_e, d) => cb(d)),
  onStats:      (cb) => ipcRenderer.on('stats',         (_e, d) => cb(d)),
  sendControl:  (cmd) => ipcRenderer.send('control', cmd),
  sendGeoCoords: (lat, lon) => ipcRenderer.send('geo-coords', { lat, lon }),
  dragStart: (offX, offY) => ipcRenderer.send('drag-start', { offX, offY }),
  dragEnd:   ()           => ipcRenderer.send('drag-end'),
  reportBounds: (rect)   => ipcRenderer.send('island-bounds', rect),
});
