// Project Freedom Battleship — 3D battle view.
// Realistic water + dusk sky, two holographic 10x10 grids, photo-real ship sprites,
// shells with smoke trails, splashes, explosions, burning hits, sinking ships, cinematic camera.
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';

const SHIP_IMG = ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'];
const SHIP_NAME = ['CARRIER', 'BATTLESHIP', 'CRUISER', 'SUBMARINE', 'DESTROYER'];
const COLS = 'ABCDEFGHIJ';
const GAP = 7.5;                                  // distance from origin to each grid centre (z)

export function createBattle3D(container, cfg = {}) {
  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.34;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 20000);
  camera.layers.enable(1);

  // dusk sky + sun
  const sky = new Sky(); sky.scale.setScalar(10000); scene.add(sky);
  const su = sky.material.uniforms;
  su.turbidity.value = 6; su.rayleigh.value = 4; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.9;
  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(89.2), THREE.MathUtils.degToRad(195));
  su.sunPosition.value.copy(sun);

  // ocean
  const normals = new THREE.TextureLoader().load('assets/fx/waternormals.jpg', t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
  const water = new Water(new THREE.PlaneGeometry(10000, 10000), {
    textureWidth: 512, textureHeight: 512, waterNormals: normals,
    sunDirection: sun.clone(), sunColor: 0xffb070, waterColor: 0x021a26, distortionScale: 4.5, fog: false, alpha: 1,
  });
  water.rotation.x = -Math.PI / 2; scene.add(water);
  // environment light from the sky for the sprites
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(sky.clone());
  scene.environment = pmrem.fromScene(envScene).texture;
  scene.add(new THREE.HemisphereLight(0xffe2c4, 0x10223a, 1.1));

  // ---------- grids ----------
  const grids = {};
  function makeGrid(side) {
    const g = new THREE.Group(); g.position.z = side === 'enemy' ? -GAP : GAP; scene.add(g);
    const col = side === 'enemy' ? 0xff3b5c : 0x7CFF2E;
    const pts = [];
    for (let i = 0; i <= 10; i++) { pts.push(-5, 0, i - 5, 5, 0, i - 5, i - 5, 0, -5, i - 5, 0, 5); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.55 }));
    lines.position.y = 0.06; g.add(lines);
    // translucent panel so the grid reads clearly on the water
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 10.4), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.05, depthWrite: false }));
    panel.rotation.x = -Math.PI / 2; panel.position.y = 0.04; g.add(panel);
    // coordinate labels
    const label = (txt) => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
      x.font = '700 40px Chakra Petch, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#' + col.toString(16).padStart(6, '0'); x.fillText(txt, 32, 34);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })); s.scale.setScalar(0.55); return s; };
    for (let i = 0; i < 10; i++) {
      const a = label(COLS[i]); a.position.set(i - 4.5, 0.35, -5.6); g.add(a);
      const b = label(String(i + 1)); b.position.set(-5.6, 0.35, i - 4.5); g.add(b);
    }
    // hover reticle
    const ret = new THREE.Group(); ret.visible = false; g.add(ret);
    const rm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.4, 40), rm); ring.rotation.x = -Math.PI / 2; ret.add(ring);
    for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.22), rm); t.rotation.x = -Math.PI / 2; t.rotation.z = k * Math.PI / 2; t.position.set(Math.cos(k * Math.PI / 2) * 0.5, 0, Math.sin(k * Math.PI / 2) * 0.5); ret.add(t); }
    ret.position.y = 0.1;
    g.traverse(o => { if (!o.isMesh || o.geometry.type !== "PlaneGeometry" || o.parent !== g) o.layers.set(1); });
    panel.layers.set(1);
    grids[side] = { g, ret, markers: {}, ships: {} };
  }
  makeGrid('enemy'); makeGrid('me');
  const cellPos = (side, r, c) => new THREE.Vector3(c - 4.5, 0, (side === 'enemy' ? -GAP : GAP) + r - 4.5);

  // ---------- ships (photo sprites on the water) ----------
  const loader = new THREE.TextureLoader();
  const shipTex = SHIP_IMG.map(n => { const t = loader.load('assets/ships/' + n + '.png'); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; });
  const shipAspect = [235 / 900, 137 / 900, 125 / 900, 129 / 900, 140 / 900];
  function makeShip(id, cells) {
    const horiz = cells.every(([r]) => r === cells[0][0]);
    const len = cells.length, w = Math.min(1.15, Math.max(0.6, len * shipAspect[id - 1] * 1.8));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.98, w), new THREE.MeshBasicMaterial({ map: shipTex[id - 1], transparent: true, alphaTest: 0.05, color: 0xffffff, toneMapped: false }));
    m.rotation.x = -Math.PI / 2;
    if (!horiz) m.rotation.z = -Math.PI / 2;
    const rs = cells.map(c => c[0]), cs = cells.map(c => c[1]);
    m.userData = { r: (Math.min(...rs) + Math.max(...rs)) / 2, c: (Math.min(...cs) + Math.max(...cs)) / 2, id, horiz };
    return m;
  }
  function setFleet(side, grid, visible = true) {
    const G = grids[side];
    Object.values(G.ships).forEach(s => G.g.remove(s)); G.ships = {};
    const byId = {};
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) { const id = grid[r][c]; if (id > 0) (byId[id] = byId[id] || []).push([r, c]); }
    Object.entries(byId).forEach(([id, cells]) => {
      const s = makeShip(+id, cells); s.position.set(s.userData.c - 4.5, 0.08, s.userData.r - 4.5); s.visible = visible;
      s.userData.cells = cells; G.g.add(s); G.ships[id] = s;
    });
  }

  // ---------- particles ----------
  const tex = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 128; draw(c.getContext('2d')); return new THREE.CanvasTexture(c); };
  const softTex = tex(g => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
  const fireTex = tex(g => { const gr = g.createRadialGradient(64, 70, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.3, 'rgba(255,170,50,.95)'); gr.addColorStop(0.65, 'rgba(220,60,10,.5)'); gr.addColorStop(1, 'rgba(120,20,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
  const smokeTex = tex(g => { for (let i = 0; i < 9; i++) { const x = 40 + Math.random() * 48, y = 40 + Math.random() * 48, r = 22 + Math.random() * 20; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); } });
  const parts = [];
  function spawn(o) {
    const mat = new THREE.SpriteMaterial({ map: o.tex, color: o.color ?? 0xffffff, transparent: true, depthWrite: false, opacity: o.opacity ?? 1, blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending });
    const s = new THREE.Sprite(mat); s.position.copy(o.pos); s.scale.setScalar(o.size); s.material.rotation = Math.random() * 6.28; s.layers.set(1); scene.add(s);
    parts.push({ s, v: o.vel || new THREE.Vector3(), g: o.grav ?? 0, life: 0, max: o.life, grow: o.grow ?? 0, op: o.opacity ?? 1, drag: o.drag ?? 1, spin: (Math.random() - 0.5) * (o.spin ?? 0) });
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life += dt; const k = p.life / p.max;
      p.v.y -= p.g * dt; p.v.multiplyScalar(Math.pow(p.drag, dt * 60)); p.s.position.addScaledVector(p.v, dt);
      p.s.scale.addScalar(p.grow * dt); p.s.material.rotation += p.spin * dt; p.s.material.opacity = p.op * (1 - k);
      if (k >= 1 || p.s.position.y < -0.3) { scene.remove(p.s); p.s.material.dispose(); parts.splice(i, 1); }
    }
  }
  const R = (a, b) => a + Math.random() * (b - a);
  function splashFx(p) {
    for (let i = 0; i < 46; i++) spawn({ tex: softTex, color: 0xe8f4ff, pos: p.clone().add(new THREE.Vector3(R(-.2, .2), .1, R(-.2, .2))), vel: new THREE.Vector3(R(-1.2, 1.2), R(5, 10), R(-1.2, 1.2)), grav: 14, life: R(.9, 1.4), size: R(.25, .5), opacity: .9, grow: .3 });
    for (let i = 0; i < 18; i++) { const a = i / 18 * 6.28; spawn({ tex: softTex, color: 0xffffff, pos: p.clone().add(new THREE.Vector3(Math.cos(a) * .3, .08, Math.sin(a) * .3)), vel: new THREE.Vector3(Math.cos(a) * 2.2, .2, Math.sin(a) * 2.2), life: 1.2, size: .35, opacity: .7, drag: .96 }); }
    shake(0.15);
  }
  function blastFx(p, big = 1) {
    flash(p, big);
    for (let i = 0; i < 28 * big; i++) spawn({ tex: fireTex, add: true, pos: p.clone().add(new THREE.Vector3(R(-.3, .3), R(.1, .5), R(-.3, .3))), vel: new THREE.Vector3(R(-2, 2), R(1.5, 5), R(-2, 2)).multiplyScalar(big), grav: 2, life: R(.5, 1), size: R(.6, 1.3) * big, grow: 1.4 * big, drag: .93 });
    for (let i = 0; i < 36 * big; i++) spawn({ tex: softTex, add: true, color: 0xffc070, pos: p.clone().add(new THREE.Vector3(0, .3, 0)), vel: new THREE.Vector3(R(-6, 6), R(3, 10), R(-6, 6)).multiplyScalar(big), grav: 12, life: R(.6, 1.2), size: .12, drag: .98 });
    for (let i = 0; i < 16 * big; i++) spawn({ tex: smokeTex, color: 0x2a2724, pos: p.clone().add(new THREE.Vector3(R(-.4, .4), R(.4, 1), R(-.4, .4))), vel: new THREE.Vector3(R(-.4, .4), R(.6, 1.6), R(-.4, .4)), life: R(2, 3.2), size: R(.8, 1.4) * big, grow: 1.1, opacity: .85, spin: 1 });
    shake(0.45 * big);
  }
  // muzzle-flash light
  const fl = new THREE.PointLight(0xffa040, 0, 30); scene.add(fl);
  function flash(p, big) { fl.position.copy(p).add(new THREE.Vector3(0, 1.5, 0)); fl.intensity = 260 * big; }
  // burning cells keep emitting fire + smoke
  const burning = [];
  function addFire(side, r, c) { burning.push({ p: cellPos(side, r, c).add(new THREE.Vector3(0, .15, 0)), t: 0, side }); }
  function stepFires(dt) {
    burning.forEach(b => {
      b.t += dt;
      if (Math.random() < dt * 14) spawn({ tex: fireTex, add: true, pos: b.p.clone().add(new THREE.Vector3(R(-.2, .2), 0, R(-.2, .2))), vel: new THREE.Vector3(R(-.2, .2), R(.8, 1.6), R(-.2, .2)), life: R(.45, .8), size: R(.35, .6), grow: -.2 });
      if (Math.random() < dt * 5) spawn({ tex: smokeTex, color: 0x1e1c1b, pos: b.p.clone().add(new THREE.Vector3(0, .5, 0)), vel: new THREE.Vector3(R(-.1, .3), R(.9, 1.5), R(-.2, .1)), life: R(2.5, 3.5), size: .6, grow: .9, opacity: .7, spin: .6 });
    });
  }
  // miss marker: small floating white buoy ring
  function addMiss(side, r, c) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.2, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.copy(cellPos(side, r, c)).setY(0.09); m.layers.set(1); scene.add(m);
  }

  // ---------- shells ----------
  const shells = [];
  function fireShell(from, to, dur) {
    return new Promise(res => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xffd28a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.scale.setScalar(0.45); s.layers.set(1); scene.add(s);
      const peak = from.distanceTo(to) * 0.35 + 3;
      shells.push({ s, from, to, t: 0, dur, peak, res });
      flash(from, 0.6);
      for (let i = 0; i < 12; i++) spawn({ tex: smokeTex, color: 0x8a8580, pos: from.clone(), vel: new THREE.Vector3(R(-1, 1), R(.5, 2), R(-1, 1)), life: 1.6, size: .7, grow: 1.2, opacity: .6 });
    });
  }
  function stepShells(dt) {
    for (let i = shells.length - 1; i >= 0; i--) {
      const sh = shells[i]; sh.t += dt; const k = Math.min(sh.t / sh.dur, 1);
      const p = sh.from.clone().lerp(sh.to, k); p.y += Math.sin(k * Math.PI) * sh.peak; sh.s.position.copy(p);
      spawn({ tex: smokeTex, color: 0xb8b2aa, pos: p.clone(), vel: new THREE.Vector3(0, .15, 0), life: .9, size: .28, grow: .6, opacity: .55 });
      if (k >= 1) { scene.remove(sh.s); shells.splice(i, 1); sh.res(); }
    }
  }

  // ---------- full-screen banner ----------
  if (!document.getElementById('bs3d-css')) {
    const st = document.createElement('style'); st.id = 'bs3d-css';
    st.textContent = `
.bs-ban{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;pointer-events:none;opacity:0;transition:opacity .2s}
.bs-ban.on{opacity:1}
.bs-ban .bg{position:absolute;inset:0;background:radial-gradient(circle,rgba(255,60,40,.35),rgba(5,4,10,.75) 65%)}
.bs-ban.win .bg{background:radial-gradient(circle,rgba(124,255,46,.32),rgba(5,4,10,.75) 65%)}
.bs-ban .t{position:relative;text-align:center;transform:scale(0) rotate(-6deg)}
.bs-ban.on .t{animation:bsSlam .45s cubic-bezier(.2,1.8,.4,1) forwards}
.bs-ban b{display:block;font:400 clamp(70px,13vw,190px)/.85 Anton,Impact,sans-serif;color:#fff;letter-spacing:.03em;-webkit-text-stroke:3px rgba(0,0,0,.4);text-shadow:0 10px 0 rgba(0,0,0,.55),0 0 50px #ff3b2e}
.bs-ban.win b{text-shadow:0 10px 0 rgba(0,0,0,.55),0 0 50px #7CFF2E}
.bs-ban i{display:block;margin-top:10px;font:700 clamp(14px,2.3vw,30px) 'Chakra Petch',sans-serif;font-style:normal;letter-spacing:.3em;color:#ffd166;text-shadow:0 0 14px #ff8a00,0 3px 0 #000}
@keyframes bsSlam{to{transform:scale(1) rotate(-3deg)}}
.bs-turn{position:absolute;left:50%;top:14px;transform:translateX(-50%);font:700 14px 'Chakra Petch',sans-serif;letter-spacing:.3em;padding:8px 18px;color:#06070a;background:#7CFF2E;
  clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%);box-shadow:0 0 20px #7CFF2E;z-index:2;pointer-events:none;transition:background .3s,box-shadow .3s}
.bs-turn.enemy{background:#ff3b5c;box-shadow:0 0 20px #ff3b5c;color:#fff}`;
    document.head.appendChild(st);
  }
  const ban = document.createElement('div'); ban.className = 'bs-ban'; ban.innerHTML = '<div class="bg"></div><div class="t"><b></b><i></i></div>'; document.body.appendChild(ban);
  function banner(big, small, win, ms = 1700) {
    return new Promise(res => {
      ban.querySelector('b').textContent = big; ban.querySelector('i').textContent = small;
      ban.classList.toggle('win', !!win);
      const t = ban.querySelector('.t'); t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
      ban.classList.add('on'); setTimeout(() => { ban.classList.remove('on'); res(); }, ms);
    });
  }
  const turnEl = document.createElement('div'); turnEl.className = 'bs-turn'; turnEl.textContent = 'YOUR TURN — FIRE!'; container.appendChild(turnEl);

  // ---------- camera ----------
  let focusSide = 'enemy';
  const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3();
  // fit the whole 10x10 grid (plus labels) on screen for the current aspect
  const fitCache = {};
  const probe = new THREE.PerspectiveCamera();
  function fitDist() {
    const key = camera.aspect.toFixed(2); if (fitCache[key]) return fitCache[key];
    probe.fov = camera.fov; probe.aspect = camera.aspect; probe.updateProjectionMatrix();
    const dir = new THREE.Vector3(0, 0.78, 0.63).normalize(), look = new THREE.Vector3(0, 0, 0.3);
    const pts = []; for (const x of [-6, 5.4]) for (const z of [-6, 5.4]) pts.push(new THREE.Vector3(x, 0.4, z));
    let d = 8; for (; d < 80; d += 0.25) {
      probe.position.copy(look).addScaledVector(dir, d); probe.lookAt(look); probe.updateMatrixWorld(true);
      if (pts.every(p => { const v = p.clone().project(probe); return Math.abs(v.x) < 0.94 && Math.abs(v.y) < 0.86; })) break;
    }
    return (fitCache[key] = d);
  }
  function desiredCam(side) {
    const z = side === 'enemy' ? -GAP : GAP, d = fitDist();
    const look = new THREE.Vector3(0, 0, z + 0.3);
    const pos = look.clone().add(new THREE.Vector3(0, 0.78, 0.63).normalize().multiplyScalar(d));
    return { look, pos };
  }
  function focus(side) { focusSide = side; turnEl.classList.toggle('enemy', side === 'me'); turnEl.textContent = side === 'enemy' ? 'YOUR TURN — FIRE!' : 'ENEMY FIRING — BRACE!'; }
  let shakeAmt = 0; function shake(a) { shakeAmt = Math.max(shakeAmt, a); }

  // ---------- picking ----------
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function cellAt(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera); const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(plane, p)) return null;
    const c = Math.floor(p.x + 5), rr = Math.floor(p.z + GAP + 5);
    if (c < 0 || c > 9 || rr < 0 || rr > 9) return null; return { r: rr, c };
  }
  renderer.domElement.addEventListener('pointermove', e => {
    const G = grids.enemy, cell = (focusSide === 'enemy' && cfg.canFire && cfg.canFire()) ? cellAt(e) : null;
    G.ret.visible = !!cell; renderer.domElement.style.cursor = cell ? 'crosshair' : 'default';
    if (cell) G.ret.position.set(cell.c - 4.5, 0.1, cell.r - 4.5);
  });
  renderer.domElement.addEventListener('click', e => {
    if (focusSide !== 'enemy' || !cfg.canFire || !cfg.canFire()) return;
    const cell = cellAt(e); if (cell && cfg.onFire) cfg.onFire(cell.r, cell.c);
  });

  // ---------- public: animate one shot ----------
  const done = { enemy: new Set(), me: new Set() };
  async function shoot({ side, r, c, hit, sunk }) {
    const key = r + '-' + c; if (done[side].has(key)) return; done[side].add(key);
    grids.enemy.ret.visible = false;
    focus(side === 'enemy' ? 'enemy' : 'me');
    await wait(side === 'me' ? 650 : 120);
    const to = cellPos(side, r, c).setY(0.1);
    const from = side === 'enemy' ? new THREE.Vector3(R(-6, 6), 0.5, GAP + 9) : new THREE.Vector3(R(-6, 6), 0.5, -GAP - 12);
    await fireShell(from, to, 0.95);
    if (hit) { blastFx(to, 1); addFire(side, r, c); } else { splashFx(to); addMiss(side, r, c); }
    if (hit && sunk) {
      await wait(350);
      const G = grids[side];
      let ship = G.ships[sunk.id];
      if (!ship) { ship = makeShip(sunk.id, sunk.cells); ship.position.set(ship.userData.c - 4.5, 0.08, ship.userData.r - 4.5); G.g.add(ship); G.ships[sunk.id] = ship; }
      ship.visible = true; ship.userData.sinking = 0;
      sunk.cells.forEach(([rr, cc]) => { blastFx(cellPos(side, rr, cc).setY(.2), 0.7); if (rr !== r || cc !== c) addFire(side, rr, cc); });
      blastFx(ship.getWorldPosition(new THREE.Vector3()).setY(.3), 1.8);
      await banner('SHIP DOWN!', (side === 'enemy' ? 'ENEMY ' : 'YOUR ') + SHIP_NAME[sunk.id - 1] + ' SUNK', side === 'enemy', 1600);
    }
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ---------- loop ----------
  function resize() {
    const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();
  const d0 = desiredCam('enemy'); camera.position.copy(d0.pos); camTarget.copy(d0.look); camera.lookAt(camTarget);
  const clock = new THREE.Clock();
  (function loop() {
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    water.material.uniforms.time.value += dt * 0.6;
    const d = desiredCam(focusSide);
    camPos.copy(camera.position).lerp(d.pos, Math.min(1, dt * 2.2)); camera.position.copy(camPos);
    camTarget.lerp(d.look, Math.min(1, dt * 2.2));
    camera.position.x += Math.sin(t * 0.25) * 0.004;
    camera.lookAt(camTarget);
    if (shakeAmt > 0.002) { camera.position.x += R(-1, 1) * shakeAmt; camera.position.y += R(-1, 1) * shakeAmt; shakeAmt *= 0.86; }
    // ships bob; sinking ships tilt and go down
    ['enemy', 'me'].forEach(side => Object.values(grids[side].ships).forEach((s, i) => {
      if (s.userData.sinking !== undefined) {
        s.userData.sinking = Math.min(s.userData.sinking + dt * 0.35, 1); const k = s.userData.sinking;
        s.position.y = 0.08 - k * 0.07; s.material.opacity = 1 - k * 0.25; s.material.color.setRGB(1 - k * 0.6, 1 - k * 0.7, 1 - k * 0.72);
        s.rotation.y = (s.userData.horiz ? 1 : -1) * k * 0.18;
      } else { s.position.y = 0.08 + Math.sin(t * 1.3 + i) * 0.02; }
    }));
    grids.enemy.ret.rotation.y = t * 1.5; grids.enemy.ret.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
    fl.intensity *= 0.86;
    stepShells(dt); stepFires(dt); stepParts(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  })();

  return {
    setMyFleet: grid => setFleet('me', grid, true),
    shoot, focus, banner,
    victory: () => banner('VICTORY!', 'ENEMY FLEET DESTROYED', true, 2200),
    defeat: () => banner('DEFEATED', 'YOUR FLEET IS AT THE BOTTOM', false, 2200),
  };
}
