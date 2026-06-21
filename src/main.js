const { app, BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const readline = require('readline');
const fs = require('fs');

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=48 --optimize-for-size');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

let win = null;
let helper = null;
let respawnDelay = 500;
let isDragging = false;
let dragOffX = 0, dragOffY = 0;
let wasHovering = false;

const WIN_W = 460;
const WIN_H = 200;

function helperPath() {
  return path.join(__dirname, '..', 'smtc-helper', 'bin', 'Release',
    'net9.0-windows10.0.19041.0', 'win-x64', 'SmtcHelper.exe');
}

function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;
  const x = Math.round(wa.x + (wa.width - WIN_W) / 2);
  const y = wa.y + 6;

  win = new BrowserWindow({
    width: WIN_W, height: WIN_H, x, y,
    frame: false, transparent: true, resizable: false,
    movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    focusable: false, fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Start in click-through mode
  win.setIgnoreMouseEvents(true);
}

// ── Hover detection + drag via cursor polling ──
// No system-wide mouse hook → zero global mouse lag
function startCursorPoll() {
  setInterval(() => {
    if (!win || win.isDestroyed()) return;

    const { x: mx, y: my } = screen.getCursorScreenPoint();

    // Drag: move window at cursor speed, works even outside window bounds
    if (isDragging) {
      win.setPosition(Math.round(mx - dragOffX), Math.round(my - dragOffY));
      return;
    }

    // Hover detection: compare cursor vs window bounds
    const b = win.getBounds();
    const hovering = mx >= b.x && mx <= b.x + b.width &&
                     my >= b.y && my <= b.y + b.height;

    if (hovering !== wasHovering) {
      wasHovering = hovering;
      // Enable/disable click-through based on hover
      win.setIgnoreMouseEvents(!hovering);
      if (win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('hover-change', hovering);
      }
    }
  }, 16); // ~60fps poll — single getCursorScreenPoint() call, negligible CPU
}

function startHelper() {
  const exe = helperPath();
  let proc;
  try {
    if (fs.existsSync(exe)) {
      proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    } else {
      const csproj = path.join(__dirname, '..', 'smtc-helper', 'SmtcHelper.csproj');
      proc = spawn('dotnet', ['run', '--project', csproj, '-c', 'Release'],
        { stdio: ['pipe', 'pipe', 'pipe'] });
    }
  } catch (e) {
    console.error('helper spawn failed', e);
    scheduleRespawn(); return;
  }
  helper = proc;
  respawnDelay = 500;
  const rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    line = line.trim(); if (!line) return;
    try {
      const obj = JSON.parse(line);
      if (win && !win.isDestroyed()) win.webContents.send('track', obj);
    } catch { }
  });
  proc.stderr.on('data', (d) => console.error('[helper]', d.toString()));
  proc.on('exit', (code) => {
    console.error('helper exited', code);
    helper = null; scheduleRespawn();
  });
}

function scheduleRespawn() {
  setTimeout(startHelper, respawnDelay);
  respawnDelay = Math.min(respawnDelay * 2, 10000);
}

function pollStatus() {
  const ps1 = path.join(__dirname, 'status.ps1');
  execFile('powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', ps1],
    { windowsHide: true, timeout: 8000 },
    (err, stdout) => {
      if (err) return;
      const line = stdout.trim(); if (!line) return;
      try {
        const obj = JSON.parse(line);
        if (win && !win.isDestroyed()) win.webContents.send('sys', obj);
      } catch { }
    });
}

async function sampleBrightness() {
  try {
    const { width, height } = screen.getPrimaryDisplay().size;
    const thumbW = 64, thumbH = Math.round(height * thumbW / width);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: thumbW, height: thumbH } });
    if (!sources.length) return;
    const img = sources[0].thumbnail;
    const sz = img.getSize(), buf = img.toBitmap();
    const cx = Math.floor(sz.width / 2), rw = Math.min(36, sz.width), rh = Math.min(6, sz.height);
    const x0 = Math.max(0, cx - Math.floor(rw / 2));
    let total = 0, count = 0;
    for (let y = 1; y < rh; y++)
      for (let x = x0; x < x0 + rw; x++) {
        const i = (y * sz.width + x) * 4;
        total += 0.299 * buf[i + 2] + 0.587 * buf[i + 1] + 0.114 * buf[i];
        count++;
      }
    const brightness = count > 0 ? total / count / 255 : 0.5;
    if (win && !win.isDestroyed()) win.webContents.send('brightness', brightness);
  } catch { }
}

// IPC
ipcMain.on('control', (_e, cmd) => {
  if (helper && helper.stdin.writable) helper.stdin.write(JSON.stringify(cmd) + '\n');
});

ipcMain.on('drag-start', (_e, { offX, offY }) => {
  isDragging = true;
  dragOffX = offX; dragOffY = offY;
  win.setFocusable(true);
});

ipcMain.on('drag-end', () => {
  isDragging = false;
  win.setFocusable(false);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    startHelper();
    startCursorPoll();
    pollStatus(); setInterval(pollStatus, 10000);
    sampleBrightness(); setInterval(sampleBrightness, 8000);
  });
}

app.on('window-all-closed', () => {
  if (helper) helper.kill();
  app.quit();
});
