const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const https = require('https');

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=48 --optimize-for-size');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

let win = null;
let helper = null;
let respawnDelay = 500;
let isDragging = false;
let dragOffX = 0, dragOffY = 0;
let wasHovering = false;
let cachedLat = null, cachedLon = null;
// island bounds in logical (CSS) px; default = collapsed music tab centered in 460px window
let islandRect = { x: 60, y: 7, w: 340, h: 54 };

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
// getCursorScreenPoint and getBounds both return DIP (logical px) — no sf conversion needed
function startCursorPoll() {
  function poll() {
    if (!win || win.isDestroyed()) { setTimeout(poll, 16); return; }

    const { x: mx, y: my } = screen.getCursorScreenPoint(); // DIP logical px

    if (isDragging) {
      win.setPosition(Math.round(mx - dragOffX), Math.round(my - dragOffY));
      setTimeout(poll, 4); // tight loop during drag for smooth movement
      return;
    }

    const b = win.getBounds(); // DIP logical px
    const hovering = mx >= b.x + islandRect.x &&
                     mx <= b.x + islandRect.x + islandRect.w &&
                     my >= b.y + islandRect.y &&
                     my <= b.y + islandRect.y + islandRect.h;

    if (hovering !== wasHovering) {
      wasHovering = hovering;
      win.setIgnoreMouseEvents(!hovering);
      if (win.webContents && !win.webContents.isDestroyed())
        win.webContents.send('hover-change', hovering);
    }
    setTimeout(poll, 16); // 60fps when idle
  }
  poll();
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
      if (obj.type === 'location') {
        fetchWeather(obj.lat, obj.lon);
      } else if (obj.type === 'brightness') {
        if (win && !win.isDestroyed()) win.webContents.send('brightness', obj.value);
      } else if (obj.type === 'stats') {
        if (win && !win.isDestroyed()) win.webContents.send('stats', obj);
      } else if (obj.type === 'foreground') {
        if (win && !win.isDestroyed()) win.webContents.send('foreground', { app: obj.app, iconB64: obj.iconB64 });
      } else {
        if (win && !win.isDestroyed()) win.webContents.send('track', obj);
      }
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

// IPC
ipcMain.on('control', (_e, cmd) => {
  if (helper && helper.stdin.writable) helper.stdin.write(JSON.stringify(cmd) + '\n');
});

ipcMain.on('drag-start', (_e, { offX, offY }) => {
  isDragging = true;
  // clientX/Y (CSS px) == DIP px == getCursorScreenPoint units, no conversion needed
  dragOffX = offX; dragOffY = offY;
  win.setFocusable(true);
});

ipcMain.on('drag-end', () => {
  isDragging = false;
  win.setFocusable(false);
});

// ── Weather (main process — no CORS/CSP) ──
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WinIsland/1.0' } }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchWeather(lat, lon) {
  try {
    if (lat && lon) { cachedLat = lat; cachedLon = lon; }
    lat = lat ?? cachedLat;
    lon = lon ?? cachedLon;
    if (!lat || !lon) {
      const geo = await httpsGet('https://ipwho.is/');
      if (!geo.latitude) throw new Error('no geo');
      lat = geo.latitude; lon = geo.longitude;
    }
    // Parallel: weather + reverse geocode for accurate city name
    const [wx, place] = await Promise.all([
      httpsGet(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,weathercode,apparent_temperature,windspeed_10m&windspeed_unit=kmh&timezone=auto`
      ),
      httpsGet(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`
      ).catch(() => ({}))
    ]);
    const c = wx.current;
    const a = place.address || {};
    const city = a.city || a.town || a.village || a.county || '';
    if (win && !win.isDestroyed()) win.webContents.send('weather', {
      ok: true, code: c.weathercode,
      temp: Math.round(c.temperature_2m),
      feels: Math.round(c.apparent_temperature),
      wind: Math.round(c.windspeed_10m),
      city
    });
  } catch (e) {
    console.error('[weather]', e.message);
    if (win && !win.isDestroyed()) win.webContents.send('weather', { ok: false });
  }
}

ipcMain.on('geo-coords', (_e, { lat, lon }) => fetchWeather(lat, lon));
ipcMain.on('island-bounds', (_e, rect) => {
  islandRect = rect;
  // Send physical screen bounds of island to helper for pixel brightness sampling
  if (helper && helper.stdin.writable) {
    const b = win.getBounds();
    helper.stdin.write(JSON.stringify({
      cmd: 'setbounds',
      x: Math.round(b.x + rect.x),
      y: Math.round(b.y + rect.y),
      w: Math.round(rect.w),
      h: Math.round(rect.h)
    }) + '\n');
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    // Auto-approve geolocation so renderer can get accurate GPS/WiFi coords
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => {
      cb(perm === 'geolocation');
    });
    createWindow();
    startHelper();
    startCursorPoll();
    pollStatus(); setInterval(pollStatus, 10000);
    // Weather: wait for renderer ready, then fetch
    win.webContents.once('did-finish-load', () => {
      fetchWeather();
      setInterval(fetchWeather, 15 * 60 * 1000);
    });
  });
}

app.on('window-all-closed', () => {
  if (helper) helper.kill();
  app.quit();
});
