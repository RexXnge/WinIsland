const el = {
  island:  document.getElementById('island'),
  art:     document.getElementById('art'),
  title:   document.getElementById('title'),
  artist:  document.getElementById('artist'),
  cur:     document.getElementById('cur'),
  dur:     document.getElementById('dur'),
  fill:    document.getElementById('fill'),
  srcIcon: document.getElementById('src-icon'),
  bar:     document.getElementById('bar'),
  prev:    document.getElementById('prev'),
  next:    document.getElementById('next'),
  play:    document.getElementById('play'),
  time:    document.getElementById('time'),
  date:    document.getElementById('date'),
  wxTime:  document.getElementById('wx-time'),
  wxDate:  document.getElementById('wx-date'),
  appName: document.getElementById('app-name'),
  appIcon:   document.getElementById('app-icon'),
  wxAppIcon: document.getElementById('wx-app-icon'),
  wxAppName: document.getElementById('wx-app-name'),
  gameTime:     document.getElementById('game-time'),
  gameDate:     document.getElementById('game-date'),
  gameAppIcon:  document.getElementById('game-app-icon'),
  gameAppName:  document.getElementById('game-app-name'),
  cpuVal:  document.getElementById('cpu-val'),
  gpuVal:  document.getElementById('gpu-val'),
  ramVal:  document.getElementById('ram-val'),
  cpuFill: document.getElementById('cpu-fill'),
  gpuFill: document.getElementById('gpu-fill'),
  ramFill: document.getElementById('ram-fill'),
  wxIcon:  document.getElementById('wx-icon'),
  wxTemp:  document.getElementById('wx-temp'),
  wxCity:  document.getElementById('wx-city'),
  wxCond:  document.getElementById('wx-cond'),
  wxFeels: document.getElementById('wx-feels'),
  wxWind:  document.getElementById('wx-wind'),
  tabDots: document.querySelectorAll('.tab-dot'),
};

let track = null;
let posMs = 0, durMs = 0, playing = false;
let lastTick = performance.now();
let hovering = false;
let hasMusic = false;
let currentTab = 0;

// ---------- tabs ----------
function switchTab(n) {
  currentTab = n;
  el.island.classList.toggle('tab-1', n === 1);
  el.island.classList.toggle('tab-2', n === 2);
  el.tabDots.forEach((d, i) => d.classList.toggle('active', i === n));
}

// ---------- state ----------
function refreshState() {
  el.island.classList.toggle('no-music', !hasMusic);
  el.island.classList.remove('hidden', 'collapsed', 'expanded');
  el.island.classList.add(hovering ? 'expanded' : 'collapsed');
  // Report precise island bounds to main for click-through hit-testing
  // Delay past CSS transition settle (220ms)
  setTimeout(() => {
    const r = el.island.getBoundingClientRect();
    window.island.reportBounds({ x: r.x, y: r.y, w: r.width, h: r.height });
  }, 250);
}

// ---------- music ----------
function fmt(ms) {
  if (!ms || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function applyTrack(t) {
  hasMusic = t && t.status !== 'none' && t.status !== 'stopped';
  if (!hasMusic) { track = t; refreshState(); return; }
  const changed = !track || track.title !== t.title || track.artist !== t.artist;
  track = t;
  durMs = t.durMs || 0; posMs = t.posMs || 0;
  lastTick = performance.now();
  playing = t.status === 'playing';
  el.island.classList.toggle('paused', !playing);
  if (changed) {
    el.title.textContent  = t.title  || 'Unknown';
    el.artist.textContent = t.artist || '';
    el.art.style.backgroundImage = t.thumbB64
      ? `url(data:image/png;base64,${t.thumbB64})`
      : 'linear-gradient(135deg, #2a2a35, #4a4458)';
    if (t.appIconB64) {
      el.srcIcon.src = `data:image/png;base64,${t.appIconB64}`;
      el.srcIcon.classList.add('visible');
    } else {
      el.srcIcon.classList.remove('visible');
    }
  }
  el.dur.textContent = fmt(durMs);
  refreshState();
}

// ---------- tick ----------
function tick(now) {
  const dt = now - lastTick; lastTick = now;
  if (playing) posMs += dt;
  if (hovering && durMs > 0) {
    el.fill.style.width  = Math.min(100, (posMs / durMs) * 100) + '%';
    el.cur.textContent   = fmt(posMs);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- clock ----------
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function updateClock() {
  const d = new Date();
  const t = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const dt = `${DAYS[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
  el.time.textContent = t;     el.date.textContent = dt;
  el.wxTime.textContent = t;   el.wxDate.textContent = dt;
  el.gameTime.textContent = t; el.gameDate.textContent = dt;
}
updateClock();
setInterval(updateClock, 1000);

// ---------- weather ----------
const WX = {
  0:['☀️','Clear'],    1:['🌤','Mostly clear'], 2:['⛅','Partly cloudy'], 3:['☁️','Overcast'],
  45:['🌫','Fog'],     48:['🌫','Icy fog'],
  51:['🌦','Drizzle'], 53:['🌦','Drizzle'],    55:['🌧','Heavy drizzle'],
  61:['🌧','Light rain'],63:['🌧','Rain'],      65:['🌧','Heavy rain'],
  71:['🌨','Light snow'],73:['🌨','Snow'],      75:['❄️','Heavy snow'],
  80:['🌦','Showers'],  81:['🌧','Showers'],   82:['⛈','Heavy showers'],
  95:['⛈','Thunderstorm'],96:['⛈','Hailstorm'],99:['⛈','Heavy storm'],
};

function applyWeather(d) {
  if (!d.ok) { el.wxIcon.textContent = '⚠️'; el.wxCond.textContent = 'No data'; return; }
  const [icon, cond] = WX[d.code] ?? ['🌡', 'Unknown'];
  el.wxIcon.textContent  = icon;
  el.wxTemp.textContent  = `${d.temp}°`;
  el.wxCond.textContent  = cond;
  el.wxFeels.textContent = `feels ${d.feels}°`;
  el.wxWind.textContent  = `💨 ${d.wind} km/h`;
  el.wxCity.textContent  = d.city;
}
window.island.onWeather(applyWeather);



// ---------- adaptive background ----------
let currentAlpha = 0.88, targetAlpha = 0.88;
setInterval(() => {
  if (Math.abs(currentAlpha - targetAlpha) < 0.002) return;
  currentAlpha += (targetAlpha - currentAlpha) * 0.15;
  document.documentElement.style.setProperty('--bg-alpha', currentAlpha.toFixed(3));
}, 100);
window.island.onBrightness(b => { targetAlpha = 0.88 + b * 0.10; }); // dark bg → 0.88, bright bg → 0.98

// ---------- hover (driven by main-process cursor poll, not mouseenter) ----------
window.island.onHoverChange((h) => {
  hovering = h;
  refreshState();
});

// ---------- drag ----------
el.island.addEventListener('mousedown', (e) => {
  if (e.target.closest('.ctl,.bar,.tab-dot,button')) return;
  window.island.dragStart(e.clientX, e.clientY);
});
document.addEventListener('mouseup', () => window.island.dragEnd());

// ---------- scroll to switch tabs ----------
el.island.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.deltaY > 0 && currentTab < 2) switchTab(currentTab + 1);
  else if (e.deltaY < 0 && currentTab > 0) switchTab(currentTab - 1);
}, { passive: false });

el.tabDots.forEach((dot, i) => dot.addEventListener('click', () => switchTab(i)));

// ---------- music controls ----------
el.prev.addEventListener('click', (e) => { e.stopPropagation(); window.island.sendControl({ cmd: 'prev' }); });
el.next.addEventListener('click', (e) => { e.stopPropagation(); window.island.sendControl({ cmd: 'next' }); });
el.play.addEventListener('click', (e) => { e.stopPropagation(); window.island.sendControl({ cmd: 'toggle' }); });
el.bar.addEventListener('click', (e) => {
  if (!durMs) return;
  const r = el.bar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const target = Math.round(ratio * durMs);
  posMs = target;
  window.island.sendControl({ cmd: 'seek', posMs: target });
});

// ---------- ingest ----------
window.island.onTrack(applyTrack);
window.island.onSys(() => {});
window.island.onForeground(({ app, iconB64 }) => {
  const name = app.charAt(0).toUpperCase() + app.slice(1);
  el.appName.textContent = name;
  el.wxAppName.textContent = name;
  el.gameAppName.textContent = name;
  if (iconB64) {
    const src = `data:image/png;base64,${iconB64}`;
    el.appIcon.src = src;     el.appIcon.classList.add('visible');
    el.wxAppIcon.src = src;   el.wxAppIcon.classList.add('visible');
    el.gameAppIcon.src = src; el.gameAppIcon.classList.add('visible');
  } else {
    el.appIcon.classList.remove('visible');
    el.wxAppIcon.classList.remove('visible');
    el.gameAppIcon.classList.remove('visible');
  }
});

window.island.onStats(({ cpu, gpu, ram }) => {
  el.cpuVal.textContent = `${cpu}%`;
  el.gpuVal.textContent = `${gpu}%`;
  el.ramVal.textContent = `${ram}%`;
  el.cpuFill.style.width = `${cpu}%`;
  el.gpuFill.style.width = `${gpu}%`;
  el.ramFill.style.width = `${ram}%`;
});

switchTab(0);
refreshState();
