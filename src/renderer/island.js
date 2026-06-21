const el = {
  island:   document.getElementById('island'),
  art:      document.getElementById('art'),
  title:    document.getElementById('title'),
  artist:   document.getElementById('artist'),
  cur:      document.getElementById('cur'),
  dur:      document.getElementById('dur'),
  fill:     document.getElementById('fill'),
  bar:      document.getElementById('bar'),
  prev:     document.getElementById('prev'),
  next:     document.getElementById('next'),
  play:     document.getElementById('play'),
  time:     document.getElementById('time'),
  date:     document.getElementById('date'),
  wxIcon:   document.getElementById('wx-icon'),
  wxTemp:   document.getElementById('wx-temp'),
  wxCity:   document.getElementById('wx-city'),
  wxCond:   document.getElementById('wx-cond'),
  wxFeels:  document.getElementById('wx-feels'),
  wxWind:   document.getElementById('wx-wind'),
  tabDots:  document.querySelectorAll('.tab-dot'),
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
  el.tabDots.forEach((d, i) => d.classList.toggle('active', i === n));
}

// ---------- state ----------
function refreshState() {
  el.island.classList.toggle('no-music', !hasMusic);
  el.island.classList.remove('hidden', 'collapsed', 'expanded');
  el.island.classList.add(hovering ? 'expanded' : 'collapsed');
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
    el.title.classList.remove('scroll');
    requestAnimationFrame(() => {
      if (el.title.scrollWidth > 180) el.title.classList.add('scroll');
    });
    el.art.style.backgroundImage = t.thumbB64
      ? `url(data:image/png;base64,${t.thumbB64})`
      : 'linear-gradient(135deg, #2a2a35, #4a4458)';
  }
  el.dur.textContent = fmt(durMs);
  refreshState();
}

// ---------- progress tick (DOM updates only when expanded) ----------
function tick(now) {
  const dt = now - lastTick; lastTick = now;
  if (playing) posMs += dt;
  if (hovering && durMs > 0) {
    el.fill.style.width   = Math.min(100, (posMs / durMs) * 100) + '%';
    el.cur.textContent    = fmt(posMs);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- clock ----------
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function updateClock() {
  const d = new Date();
  el.time.textContent = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  el.date.textContent = `${DAYS[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}
updateClock();
setInterval(updateClock, 1000);

// ---------- weather ----------
const WX = {
  0:['☀️','Clear'],   1:['🌤','Mostly clear'], 2:['⛅','Partly cloudy'], 3:['☁️','Overcast'],
  45:['🌫','Fog'],    48:['🌫','Icy fog'],
  51:['🌦','Drizzle'],53:['🌦','Drizzle'],     55:['🌧','Heavy drizzle'],
  61:['🌧','Light rain'],63:['🌧','Rain'],     65:['🌧','Heavy rain'],
  71:['🌨','Light snow'],73:['🌨','Snow'],     75:['❄️','Heavy snow'],
  80:['🌦','Showers'], 81:['🌧','Showers'],   82:['⛈','Heavy showers'],
  85:['🌨','Snow showers'],86:['❄️','Heavy snow showers'],
  95:['⛈','Thunderstorm'],96:['⛈','Hailstorm'],99:['⛈','Heavy storm'],
};

async function fetchWeather() {
  try {
    const geo = await fetch('https://ipapi.co/json/').then(r => r.json());
    const { latitude, longitude, city } = geo;
    const wx = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weathercode,apparent_temperature,windspeed_10m&windspeed_unit=kmh&timezone=auto`
    ).then(r => r.json());
    const c = wx.current;
    const [icon, cond] = WX[c.weathercode] ?? ['🌡','Unknown'];
    el.wxIcon.textContent  = icon;
    el.wxTemp.textContent  = `${Math.round(c.temperature_2m)}°`;
    el.wxCond.textContent  = cond;
    el.wxFeels.textContent = `feels ${Math.round(c.apparent_temperature)}°`;
    el.wxWind.textContent  = `💨 ${Math.round(c.windspeed_10m)} km/h`;
    el.wxCity.textContent  = city || '';
  } catch {
    el.wxIcon.textContent = '⚠️';
    el.wxCond.textContent = 'No data';
  }
}
fetchWeather();
setInterval(fetchWeather, 15 * 60 * 1000);

// ---------- dynamic background ----------
let currentAlpha = 0.52, targetAlpha = 0.52;
setInterval(() => {
  if (Math.abs(currentAlpha - targetAlpha) < 0.002) return;
  currentAlpha += (targetAlpha - currentAlpha) * 0.18;
  document.documentElement.style.setProperty('--bg-alpha', currentAlpha.toFixed(3));
}, 100);
window.island.onBrightness(b => { targetAlpha = 0.28 + b * 0.62; });

// ---------- interactions ----------

// Hover → expand + enable click capture (needed for drag + buttons)
el.island.addEventListener('mouseenter', () => {
  hovering = true;
  window.island.setIgnoreMouse(false);
  refreshState();
});
el.island.addEventListener('mouseleave', () => {
  hovering = false;
  window.island.setIgnoreMouse(true);
  window.island.dragEnd();
  refreshState();
});

// Drag — mousedown on island background makes window temporarily focusable
// so -webkit-app-region: drag can do OS-level smooth window move
el.island.addEventListener('mousedown', (e) => {
  if (e.target.closest('.ctl,.bar,.tab-dot,button')) return;
  window.island.dragStart();
});
document.addEventListener('mouseup', () => window.island.dragEnd());

// Scroll to switch tabs
el.island.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.deltaY > 0 && currentTab === 0) switchTab(1);
  else if (e.deltaY < 0 && currentTab === 1) switchTab(0);
}, { passive: false });

// Tab dot clicks
el.tabDots.forEach((dot, i) => dot.addEventListener('click', () => switchTab(i)));

// Music controls
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
window.island.onSys(() => {}); // sys data consumed but wifi/vol removed from UI

switchTab(0);
refreshState();
window.island.setIgnoreMouse(true); // start in click-through mode
