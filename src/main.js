const { app, BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const readline = require('readline');
const fs = require('fs');

// Reduce V8 heap, disable Electron's own SMTC hijack (we use our C# helper)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=48 --optimize-for-size');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

let win = null;
let helper = null;
let respawnDelay = 500;
let sysTimer = null;

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
    width: WIN_W,
    height: WIN_H,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
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
    scheduleRespawn();
    return;
  }

  helper = proc;
  respawnDelay = 500;

  const rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    try {
      const obj = JSON.parse(line);
      if (win && !win.isDestroyed()) win.webContents.send('track', obj);
    } catch { /* skip malformed */ }
  });

  proc.stderr.on('data', (d) => console.error('[helper]', d.toString()));
  proc.on('exit', (code) => {
    console.error('helper exited', code);
    helper = null;
    scheduleRespawn();
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
      const line = stdout.trim();
      if (!line) return;
      try {
        const obj = JSON.parse(line);
        if (win && !win.isDestroyed()) win.webContents.send('sys', obj);
      } catch { /* skip */ }
    });
}

function startStatusPolling() {
  pollStatus();
  // 10s is plenty for wifi/volume — saves CPU from frequent PS spawns
  sysTimer = setInterval(pollStatus, 10000);
}

async function sampleBrightness() {
  try {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.size;
    // 64px thumbnail — was 320px. ~25× smaller buffer, same accuracy for avg brightness
    const thumbW = 64;
    const thumbH = Math.round(height * thumbW / width);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbW, height: thumbH }
    });
    if (!sources.length) return;

    const img = sources[0].thumbnail;
    const sz = img.getSize();
    const buf = img.toBitmap(); // BGRA

    const cx = Math.floor(sz.width / 2);
    const rw = Math.min(36, sz.width);
    const rh = Math.min(6, sz.height);
    const x0 = Math.max(0, cx - Math.floor(rw / 2));

    let total = 0, count = 0;
    for (let y = 1; y < rh; y++) {
      for (let x = x0; x < x0 + rw; x++) {
        const i = (y * sz.width + x) * 4;
        total += 0.299 * buf[i + 2] + 0.587 * buf[i + 1] + 0.114 * buf[i];
        count++;
      }
    }
    const brightness = count > 0 ? total / count / 255 : 0.5;
    if (win && !win.isDestroyed()) win.webContents.send('brightness', brightness);
  } catch { /* ignore */ }
}

function startBrightnessSampling() {
  sampleBrightness();
  // 8s interval — was 600ms. Brightness behind a small overlay changes slowly.
  setInterval(sampleBrightness, 8000);
}

ipcMain.on('control', (_e, cmd) => {
  if (helper && helper.stdin.writable) {
    helper.stdin.write(JSON.stringify(cmd) + '\n');
  }
});

ipcMain.on('set-ignore-mouse', (_e, ignore) => {
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(!!ignore, { forward: true });
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    startHelper();
    startStatusPolling();
    startBrightnessSampling();
  });
}

app.on('window-all-closed', () => {
  if (helper) helper.kill();
  app.quit();
});
