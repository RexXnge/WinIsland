const el = {
  island: document.getElementById('island'),
  art: document.getElementById('art'),
  title: document.getElementById('title'),
  artist: document.getElementById('artist'),
  cur: document.getElementById('cur'),
  dur: document.getElementById('dur'),
  fill: document.getElementById('fill'),
  bar: document.getElementById('bar'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  play: document.getElementById('play'),
  wifi: document.getElementById('wifi'),
  vol: document.getElementById('vol'),
  volPct: document.getElementById('vol-pct'),
  time: document.getElementById('time'),
  date: document.getElementById('date')
};

let track = null;
let posMs = 0, durMs = 0, playing = false;
let lastTick = performance.now();
let hovering = false;
let hasMusic = false;
let interactiveHovered = 0;

// ---------- state machine ----------
function setSize(s) {
  el.island.classList.remove('hidden', 'collapsed', 'expanded');
  el.island.classList.add(s);
  el.island.dataset.state = s;
}

function refreshState() {
  el.island.classList.toggle('no-music', !hasMusic);
  setSize(hovering ? 'expanded' : 'collapsed');
}

// ---------- music render ----------
function fmt(ms) {
  if (!ms || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function applyTrack(t) {
  hasMusic = t && t.status !== 'none' && t.status !== 'stopped';
  if (!hasMusic) { track = t; refreshState(); return; }

  const changed = !track || track.title !== t.title || track.artist !== t.artist;
  track = t;
  durMs = t.durMs || 0;
  posMs = t.posMs || 0;
  lastTick = performance.now();
  playing = t.status === 'playing';

  el.island.classList.toggle('paused', !playing);

  if (changed) {
    el.title.textContent = t.title || 'Unknown';
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

// ---------- progress tick ----------
// Only update DOM when expanded (progress bar visible) — saves ~60fps DOM work when collapsed
function tick(now) {
  const dt = now - lastTick; lastTick = now;
  if (playing) posMs += dt;
  if (hovering && durMs > 0) {
    el.fill.style.width = Math.min(100, (posMs / durMs) * 100) + '%';
    el.cur.textContent = fmt(posMs);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- system status ----------
function applySys(s) {
  if (s.wifi === 'connected') {
    el.wifi.classList.remove('off');
    el.wifi.title = s.ssid ? `Wi-Fi: ${s.ssid} (${s.signal}%)` : 'Wi-Fi connected';
  } else {
    el.wifi.classList.add('off');
    el.wifi.title = 'Wi-Fi disconnected';
  }
  const v = typeof s.vol === 'number' ? s.vol : -1;
  el.volPct.textContent = v >= 0 ? v + '%' : '—';
  el.vol.title = v >= 0 ? `Volume ${v}%` : 'Volume';
}

// ---------- clock ----------
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function updateClock() {
  const d = new Date();
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  el.time.textContent = `${String(h).padStart(2,'0')}:${m}`;
  el.date.textContent = `${DAYS[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}
updateClock();
setInterval(updateClock, 1000);

// ---------- interactions ----------
el.island.addEventListener('mouseenter', () => { hovering = true; refreshState(); });
el.island.addEventListener('mouseleave', () => {
  hovering = false;
  interactiveHovered = 0;
  window.island.setIgnoreMouse(true);
  refreshState();
});

// Click-through: pass clicks to windows below except when over actual controls
function onInteractiveEnter() {
  interactiveHovered++;
  window.island.setIgnoreMouse(false);
}
function onInteractiveLeave() {
  interactiveHovered = Math.max(0, interactiveHovered - 1);
  if (interactiveHovered === 0) window.island.setIgnoreMouse(true);
}
[el.prev, el.next, el.play, el.bar].forEach(btn => {
  if (!btn) return;
  btn.addEventListener('mouseenter', onInteractiveEnter);
  btn.addEventListener('mouseleave', onInteractiveLeave);
});
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

// ---------- dynamic background ----------
// 100ms lerp — was 30ms. Imperceptible difference, 3× cheaper.
let currentAlpha = 0.52, targetAlpha = 0.52;
setInterval(() => {
  if (Math.abs(currentAlpha - targetAlpha) < 0.002) return;
  currentAlpha += (targetAlpha - currentAlpha) * 0.18;
  document.documentElement.style.setProperty('--bg-alpha', currentAlpha.toFixed(3));
}, 100);

window.island.onBrightness(b => {
  targetAlpha = 0.28 + b * 0.62;
});

// ---------- ingest ----------
window.island.onTrack(applyTrack);
window.island.onSys(applySys);

refreshState();

// Start in click-through mode — only buttons capture clicks
window.island.setIgnoreMouse(true);
