// Battleship audio: background music + synthesized sound effects (Web Audio, no extra files).
// Browsers only allow sound after the player's first click / key press, so everything is
// unlocked on the first interaction.

const MUSIC_SRC = 'assets/audio/battle-music.mp3';
const MENU_LEVEL = 1.0;    // menus: full volume
const GAME_LEVEL = 0.15;   // placement + battle: music ducked under the effects

let ctx = null, master = null, noiseBuf = null;
const music = new Audio(MUSIC_SRC);
music.loop = true; music.preload = 'auto'; music.volume = MENU_LEVEL;
let target = MENU_LEVEL, fadeTimer = null, unlocked = false;
let muted = localStorage.getItem('bs_muted') === '1';
music.muted = muted;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.25;
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
  master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

function unlock() {
  if (unlocked) return; unlocked = true;
  ensureCtx(); if (ctx && ctx.state === 'suspended') ctx.resume();
  music.play().catch(() => { unlocked = false; });
}
['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, unlock, { capture: true, passive: true }));
// try straight away too (works when the browser already trusts the site)
music.play().then(() => { unlocked = true; }).catch(() => {});

function setMusicLevel(level) {
  target = level; clearInterval(fadeTimer);
  fadeTimer = setInterval(() => {
    const v = music.volume, step = 0.04;
    if (Math.abs(v - target) <= step) { music.volume = target; clearInterval(fadeTimer); }
    else music.volume = v + (target > v ? step : -step);
  }, 30);
}

// ---------- building blocks ----------
const now = () => ctx.currentTime;
function noise(dur, t0 = now()) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05); return s;
}
function env(g, t0, a, peak, dec, end = 0.0001) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(end, t0 + a + dec);
}
function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
function filt(type, f, q = 0.8) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
function gain(v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; }
function pan(p) { if (!ctx.createStereoPanner) return gain(1); const s = ctx.createStereoPanner(); s.pan.value = p; return s; }
function ok() { return ensureCtx() && !muted && ctx.state !== 'closed'; }

// ---------- effects ----------
// rocket leaving the launcher and screaming towards the target (dur = flight time in seconds)
function launch(dur = 0.95) {
  if (!ok()) return; const t = now();
  // ignition thump
  const th = ctx.createOscillator(), tg = gain(0); th.type = 'sine';
  th.frequency.setValueAtTime(160, t); th.frequency.exponentialRampToValueAtTime(45, t + 0.25);
  chain(th, tg, master); env(tg, t, 0.005, 0.7, 0.3); th.start(t); th.stop(t + 0.4);
  // jet whoosh: band-passed noise sweeping up, then dopplering down as it closes in
  const n = noise(dur + 0.3, t), bp = filt('bandpass', 500, 1.4), g = gain(0), p = pan(-0.6);
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(3200, t + dur * 0.55);
  bp.frequency.exponentialRampToValueAtTime(900, t + dur);
  p.pan && (p.pan.setValueAtTime(-0.6, t), p.pan.linearRampToValueAtTime(0.5, t + dur));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.55, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.9, t + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
  chain(n, bp, g, p, master);
  // motor whine
  const o = ctx.createOscillator(), og = gain(0), lp = filt('lowpass', 1400);
  o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(520, t + dur * 0.6); o.frequency.exponentialRampToValueAtTime(300, t + dur);
  og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.06, t + 0.1); og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
  chain(o, lp, og, master); o.start(t); o.stop(t + dur + 0.2);
}

// missile plunging into the sea
function splash() {
  if (!ok()) return; const t = now();
  const n = noise(1.3, t), lp = filt('lowpass', 2600, 0.7), g = gain(0);
  lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(260, t + 1.1);
  chain(n, lp, g, master); env(g, t, 0.01, 0.9, 1.1);
  // deep plunge
  const o = ctx.createOscillator(), og = gain(0); o.type = 'sine';
  o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.35);
  chain(o, og, master); env(og, t, 0.005, 0.8, 0.4); o.start(t); o.stop(t + 0.5);
  // bubbles
  for (let i = 0; i < 9; i++) {
    const bt = t + 0.25 + Math.random() * 0.7, b = ctx.createOscillator(), bg = gain(0), f = 500 + Math.random() * 900;
    b.type = 'sine'; b.frequency.setValueAtTime(f, bt); b.frequency.exponentialRampToValueAtTime(f * 1.9, bt + 0.06);
    chain(b, bg, master); env(bg, bt, 0.004, 0.08, 0.07); b.start(bt); b.stop(bt + 0.1);
  }
}

// hit: explosion with a sharp crack, fireball roar and a sub-bass thump (big = size)
function explosion(big = 1, when = 0) {
  if (!ok()) return; const t = now() + when, L = 0.9 + big * 0.7;
  const crack = noise(0.12, t), hp = filt('highpass', 1800), cg = gain(0);
  chain(crack, hp, cg, master); env(cg, t, 0.002, 0.9, 0.09);
  const roar = noise(L + 0.2, t), lp = filt('lowpass', 1500, 0.6), rg = gain(0), ws = ctx.createWaveShaper();
  const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3); } ws.curve = curve;
  lp.frequency.setValueAtTime(1500, t); lp.frequency.exponentialRampToValueAtTime(120, t + L);
  chain(roar, ws, lp, rg, pan((Math.random() - 0.5) * 0.6), master); env(rg, t, 0.006, 1.0 * Math.min(1.2, big), L);
  const sub = ctx.createOscillator(), sg = gain(0); sub.type = 'sine';
  sub.frequency.setValueAtTime(95, t); sub.frequency.exponentialRampToValueAtTime(32, t + 0.7);
  chain(sub, sg, master); env(sg, t, 0.004, 1.1, 0.8); sub.start(t); sub.stop(t + 1);
  // debris crackle
  for (let i = 0; i < 6 * big; i++) {
    const dt = t + 0.15 + Math.random() * L * 0.8, d = noise(0.04, dt), dg = gain(0), bp = filt('bandpass', 1200 + Math.random() * 2500, 2);
    chain(d, bp, dg, master); env(dg, dt, 0.002, 0.25, 0.04);
  }
}
const detonation = () => explosion(0.75 + Math.random() * 0.6);

// brass-like note (used for the fanfares)
function horn(freq, t, dur, vol = 0.18) {
  [1, 1.005].forEach(det => {
    const o = ctx.createOscillator(), lp = filt('lowpass', 900, 1.2), g = gain(0); o.type = 'sawtooth'; o.frequency.value = freq * det;
    lp.frequency.setValueAtTime(700, t); lp.frequency.linearRampToValueAtTime(2600, t + 0.06); lp.frequency.exponentialRampToValueAtTime(1200, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
    g.gain.setValueAtTime(vol, t + Math.max(0.05, dur - 0.12)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    chain(o, lp, g, master); o.start(t); o.stop(t + dur + 0.05);
  });
}
function timpani(t, f = 70) {
  const o = ctx.createOscillator(), g = gain(0); o.type = 'sine';
  o.frequency.setValueAtTime(f * 1.4, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
  chain(o, g, master); env(g, t, 0.004, 0.7, 0.7); o.start(t); o.stop(t + 0.8);
}

// you sank a ship: short fanfare + crowd cheer and applause
function cheer() {
  if (!ok()) return; const t = now();
  [[523, 0, 0.14], [659, 0.14, 0.14], [784, 0.28, 0.5]].forEach(([f, d, l]) => horn(f, t + d, l, 0.14));
  // crowd "yeah": formant-filtered noise swelling
  const n = noise(2.4, t), bp1 = filt('bandpass', 700, 2.5), bp2 = filt('bandpass', 1300, 3), g = gain(0);
  n.connect(bp1); n.connect(bp2); bp1.connect(g); bp2.connect(g); g.connect(master);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.35); g.gain.exponentialRampToValueAtTime(0.18, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
  // applause: hundreds of tiny claps
  for (let i = 0; i < 160; i++) {
    const ct = t + 0.15 + Math.random() * 2.0, c = noise(0.03, ct), cb = filt('bandpass', 1400 + Math.random() * 1800, 1.5), cg = gain(0);
    chain(c, cb, cg, pan(Math.random() * 1.6 - 0.8), master); env(cg, ct, 0.001, 0.12 * (1 - (ct - t) / 2.6), 0.025);
  }
}

// you won the battle
function victory() {
  if (!ok()) return; const t = now();
  timpani(t, 65); timpani(t + 0.18, 65); timpani(t + 0.36, 82);
  const notes = [[392, 0], [523, 0.18], [659, 0.36], [784, 0.54]];
  notes.forEach(([f, d]) => horn(f, t + d, 0.2, 0.16));
  [523, 659, 784, 1047].forEach(f => horn(f, t + 0.78, 1.9, 0.11));
  timpani(t + 0.78, 52);
  // cymbal swell
  const n = noise(2.4, t + 0.7), hp = filt('highpass', 6000), g = gain(0);
  chain(n, hp, g, master); g.gain.setValueAtTime(0.0001, t + 0.7); g.gain.exponentialRampToValueAtTime(0.2, t + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
  setTimeout(cheer, 900);
}

// you lost the battle
function defeat() {
  if (!ok()) return; const t = now();
  [[392, 0], [349, 0.35], [311, 0.7]].forEach(([f, d]) => horn(f, t + d, 0.5, 0.13));
  horn(196, t + 1.05, 1.6, 0.12); horn(233, t + 1.05, 1.6, 0.09);
  timpani(t + 1.05, 45);
}

function setMuted(m) {
  muted = !!m; localStorage.setItem('bs_muted', muted ? '1' : '0');
  music.muted = muted; if (master) master.gain.value = muted ? 0 : 0.9;
  if (!muted) unlock();
}

// small speaker toggle in the corner
function mountToggle() {
  const b = document.createElement('button');
  b.id = 'soundToggle'; b.type = 'button';
  b.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:9000;width:44px;height:44px;border-radius:50%;border:1px solid rgba(124,255,46,.5);background:rgba(6,10,8,.8);color:#7CFF2E;font-size:20px;cursor:pointer;box-shadow:0 0 14px rgba(124,255,46,.25)';
  const draw = () => { b.textContent = muted ? '🔇' : '🔊'; b.setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound'); b.title = b.getAttribute('aria-label'); };
  b.addEventListener('click', () => { setMuted(!muted); draw(); });
  draw(); document.body.appendChild(b);
}
if (document.body) mountToggle(); else addEventListener('DOMContentLoaded', mountToggle);

export const SFX = {
  menu: () => setMusicLevel(MENU_LEVEL),
  game: () => setMusicLevel(GAME_LEVEL),
  launch, splash, explosion, detonation, cheer, victory, defeat, setMuted,
  musicState: () => ({ playing: !music.paused, volume: +music.volume.toFixed(2), muted, ready: music.readyState }),
};
