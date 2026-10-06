// Roadmap World: a 3D island where each completed step brings a new region to life.
// Framework-agnostic. Mount it into any DOM element with createRoadmapWorld().
import * as THREE from 'three';
import { gsap } from 'gsap';

const PI = Math.PI;
const V3 = THREE.Vector3;
const DEFAULT_KINDS = ['garden', 'well', 'hills', 'village', 'shore', 'gate'];
export const REGION_KINDS = [...DEFAULT_KINDS, 'summit'];

/**
 * @typedef {'garden'|'well'|'hills'|'village'|'shore'|'gate'|'summit'} RegionKind
 * @typedef {{ title: string, subtitle?: string, kind?: RegionKind }} RoadmapStep
 * @typedef {{
 *   steps: RoadmapStep[],
 *   progress?: number,
 *   hud?: boolean,
 *   controls?: boolean,
 *   night?: boolean,
 *   touchAction?: string,
 *   theme?: { accent?: string, accentDeep?: string, gold?: string, hero?: string, heroHat?: string },
 *   rewardText?: (index: number) => string | null,
 *   onStepComplete?: (index: number) => void,
 *   onRegionUnlocked?: (index: number) => void,
 *   onFinish?: () => void,
 * }} RoadmapWorldOptions
 */

/**
 * Mount a Roadmap World into `container`.
 * @param {HTMLElement} container
 * @param {RoadmapWorldOptions} options
 */
export function createRoadmapWorld(container, options) {
  const opts = Object.assign({ progress: 0, hud: true, controls: false, night: false, touchAction: 'pan-y', theme: {}, rewardText: () => '+10 XP' }, options);
  const steps = opts.steps || [];
  if (steps.length < 2 || steps.length > 12) throw new Error('Roadmap World needs between 2 and 12 steps.');
  const theme = Object.assign({ accent: '#2f9e6b', accentDeep: '#1f7a50', gold: '#f2c14e', hero: '#3d63dd', heroHat: '#ff8a3d' }, opts.theme);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  injectCss();

  /* ---------- DOM ---------- */
  const root = document.createElement('div');
  root.className = 'rw-stage';
  root.style.setProperty('--rw-accent', theme.accent);
  root.style.setProperty('--rw-accent-deep', theme.accentDeep);
  root.style.setProperty('--rw-gold', theme.gold);
  root.innerHTML = `
    <div class="rw-hud rw-quest" ${opts.hud ? '' : 'hidden'}>
      <span class="rw-eyebrow" data-rw="eyebrow"></span>
      <strong class="rw-title" data-rw="title"></strong>
      <span class="rw-sub" data-rw="sub"></span>
      <div class="rw-bar"><i data-rw="bar"></i></div>
    </div>
    <div class="rw-hud rw-stats" ${opts.hud ? '' : 'hidden'}><span class="rw-pill" data-rw="regions"></span></div>
    <div class="rw-hud rw-controls" ${opts.controls ? '' : 'hidden'}>
      <button type="button" data-rw="go">Complete step</button>
      <button type="button" class="rw-ghost" data-rw="night">Night</button>
      <button type="button" class="rw-ghost" data-rw="view">Overview</button>
      <button type="button" class="rw-ghost" data-rw="reset">Reset</button>
    </div>
    <div class="rw-banner" data-rw="banner"><div>Journey complete!</div></div>`;
  container.appendChild(root);
  const $ = (k) => root.querySelector(`[data-rw="${k}"]`);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    const d = document.createElement('div');
    d.className = 'rw-fallback';
    d.textContent = 'This device has 3D graphics (WebGL) turned off, so the map cannot be shown.';
    root.appendChild(d);
    return stubApi(root);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const cvs = renderer.domElement;
  cvs.style.touchAction = opts.touchAction;
  root.prepend(cvs);

  /* ---------- tween bookkeeping (never touch the app's other GSAP tweens) ---------- */
  const tweens = new Set();
  const tw = (t) => { tweens.add(t); t.eventCallback('onInterrupt', () => tweens.delete(t)); return t; };
  const to = (target, vars) => {
    const done = vars.onComplete;
    const t = gsap.to(target, Object.assign({}, vars, { onComplete() { tweens.delete(t); if (done) done.call(this); } }));
    return tw(t);
  };
  const killAll = () => { tweens.forEach((t) => t.kill()); tweens.clear(); timers.forEach(clearTimeout); timers.clear(); };
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };

  /* ---------- scene ---------- */
  const scene = new THREE.Scene();
  const C = (h) => new THREE.Color(h);
  const DAY = { sky: C('#9fd6f5'), hs: C('#e6f6ff'), hg: C('#7d9a5c'), hi: 1.15, sun: C('#fff1d6'), si: 2.6 };
  const NIGHT = { sky: C('#0e1834'), hs: C('#3a4f8f'), hg: C('#1b2433'), hi: 0.35, sun: C('#8fa6ff'), si: 0.45 };
  scene.background = DAY.sky.clone();
  scene.fog = new THREE.Fog(DAY.sky.clone(), 70, 170);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 500);
  const hemi = new THREE.HemisphereLight(DAY.hs.clone(), DAY.hg.clone(), DAY.hi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(DAY.sun.clone(), DAY.si);
  sun.position.set(30, 45, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -44, right: 44, top: 44, bottom: -44, near: 1, far: 140 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  /* ---------- terrain ---------- */
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const noise = (x, z) => Math.sin(x * 0.31 + 1.7) * Math.cos(z * 0.27 - 0.4) + 0.5 * Math.sin(x * 0.73 + z * 0.41) + 0.25 * Math.cos(x * 1.3 - z * 1.1);
  const coastR = (a) => 30 + 2.5 * Math.sin(a * 3 + 0.5) + 1.6 * Math.cos(a * 5 - 1);
  function H(x, z) {
    const r = Math.hypot(x, z), a = Math.atan2(z, x), c = coastR(a);
    const top = 0.9 + 0.28 * noise(x, z) + 4.6 * Math.exp(-(r * r) / (2 * 7.5 * 7.5));
    const t = smooth(c - 5, c + 1.5, r);
    return top + t * (-3.4 - top);
  }

  // Regions: all but the last sit on a ring around the island; the last is the summit in the middle.
  const N = steps.length;
  const ring = N - 1, a0 = 2.137, span = 5.1;
  const ZONES = steps.map((s, i) => {
    let x, z;
    if (i === N - 1) { x = -4.5; z = 4.5; }
    else {
      const a = a0 - (ring === 1 ? 0 : (i / (ring - 1)) * span);
      const r = 23.5 + 1.5 * Math.sin(i * 2.1);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
    }
    const kind = s.kind || (i === N - 1 ? 'summit' : DEFAULT_KINDS[i % DEFAULT_KINDS.length]);
    return { i, x, z, kind, title: s.title, subtitle: s.subtitle || '', unlocked: false, reveal: 0, decor: [] };
  });

  const SEG = 100, SIZE = 100;
  let tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  tg.rotateX(-PI / 2);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, H(tp.getX(i), tp.getZ(i)));
  tg = tg.toNonIndexed();
  const pos = tg.attributes.position, triCount = pos.count / 3;
  const colors = new Float32Array(pos.count * 3), base = new Float32Array(triCount * 3), grey = new Float32Array(triCount * 3);
  const triD = new Float32Array(triCount);
  const zoneTris = ZONES.map(() => []), zoneMax = ZONES.map(() => 0);
  const cSandW = C('#d8c48c'), cSand = C('#ead9a4'), cG1 = C('#79c25a'), cG2 = C('#5ead4e'), cHi = C('#9cc96a'), cSea = C('#b9a87c'), tmp = new THREE.Color();
  for (let t = 0; t < triCount; t++) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += pos.getX(t * 3 + k); cy += pos.getY(t * 3 + k); cz += pos.getZ(t * 3 + k); }
    cx /= 3; cy /= 3; cz /= 3;
    if (cy < -0.3) tmp.copy(cSea);
    else if (cy < 0.35) tmp.copy(cSandW);
    else if (cy < 0.62) tmp.copy(cSand);
    else {
      tmp.copy(cG1).lerp(cG2, 0.5 + 0.5 * Math.sin(cx * 0.45 + cz * 0.38 + noise(cz, cx)));
      if (cy > 4) tmp.lerp(cHi, smooth(4, 5.4, cy));
    }
    base[t * 3] = tmp.r; base[t * 3 + 1] = tmp.g; base[t * 3 + 2] = tmp.b;
    const l = 0.3 * tmp.r + 0.59 * tmp.g + 0.11 * tmp.b;
    grey[t * 3] = l * 0.92 + 0.03; grey[t * 3 + 1] = l * 0.9 + 0.03; grey[t * 3 + 2] = l * 0.88 + 0.035;
    let best = 0, bd = 1e9;
    ZONES.forEach((z, i) => { const d = Math.hypot(cx - z.x, cz - z.z); if (d < bd) { bd = d; best = i; } });
    triD[t] = bd; zoneTris[best].push(t); if (bd > zoneMax[best]) zoneMax[best] = bd;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  function paintZone(zi) {
    const z = ZONES[zi], R = z.reveal * (zoneMax[zi] + 3);
    for (const t of zoneTris[zi]) {
      const f = Math.min(1, Math.max(0, (R - triD[t]) / 3));
      for (let c = 0; c < 3; c++) {
        const v = grey[t * 3 + c] + (base[t * 3 + c] - grey[t * 3 + c]) * f;
        colors[t * 9 + c] = v; colors[t * 9 + 3 + c] = v; colors[t * 9 + 6 + c] = v;
      }
    }
    tg.attributes.color.needsUpdate = true;
  }
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  const wg = new THREE.PlaneGeometry(260, 260, 70, 70);
  wg.rotateX(-PI / 2);
  const wBase = Float32Array.from(wg.attributes.position.array);
  const water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: '#4fb3d9', flatShading: true, transparent: true, opacity: 0.86, roughness: 0.35, metalness: 0.1 }));
  water.receiveShadow = true;
  scene.add(water);

  /* ---------- road ---------- */
  const curve = new THREE.CatmullRomCurve3(ZONES.map((z) => new V3(z.x, 0, z.z)), false, 'centripetal');
  const RN = 700, roadPts = [];
  for (let i = 0; i <= RN; i++) roadPts.push(curve.getPoint(i / RN));
  function ribbon(w, yOff, color, em) {
    const arr = [];
    const side = (i) => {
      const t = i / RN, p = roadPts[i], tn = curve.getTangent(t);
      const nx = -tn.z, nz = tn.x, l = Math.hypot(nx, nz) || 1;
      const ax = p.x + nx / l * w / 2, az = p.z + nz / l * w / 2, bx = p.x - nx / l * w / 2, bz = p.z - nz / l * w / 2;
      return [[ax, H(ax, az) + yOff, az], [bx, H(bx, bz) + yOff, bz]];
    };
    let prev = side(0);
    for (let i = 1; i <= RN; i++) {
      const cur = side(i);
      arr.push(...prev[0], ...prev[1], ...cur[0], ...prev[1], ...cur[1], ...cur[0]);
      prev = cur;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, emissive: em || '#000000', emissiveIntensity: em ? 0.35 : 0 }));
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  ribbon(2.0, 0.13, '#d9c39a');
  const gold = ribbon(1.15, 0.17, theme.gold, '#f2a91e');
  gold.geometry.setDrawRange(0, 0);
  function roadDist(x, z) {
    let b = 1e9;
    for (let i = 0; i <= RN; i += 3) { const p = roadPts[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < b) b = d; }
    return Math.sqrt(b);
  }

  /* ---------- builders ---------- */
  const MC = {};
  const mat = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); return MC[k] || (MC[k] = new THREE.MeshStandardMaterial(Object.assign({ color: c, flatShading: true, roughness: 0.85 }, o || {}))); };
  const winMat = new THREE.MeshStandardMaterial({ color: '#5a4a35', emissive: '#ffc66b', emissiveIntensity: 0, flatShading: true });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff6c8', emissive: '#ffe27a', emissiveIntensity: 0.3, flatShading: true });
  const G = {
    cyl: new THREE.CylinderGeometry(1, 1, 1, 8), cone: new THREE.ConeGeometry(1, 1, 7), roof: new THREE.ConeGeometry(1, 1, 4).rotateY(PI / 4),
    ico: new THREE.IcosahedronGeometry(1, 0), box: new THREE.BoxGeometry(1, 1, 1), sph: new THREE.SphereGeometry(1, 10, 8), dod: new THREE.DodecahedronGeometry(1, 0),
  };
  function part(g, m, s, p, r) {
    const o = new THREE.Mesh(g, typeof m === 'string' ? mat(m) : m);
    o.scale.set(...s); o.position.set(...p); if (r) o.rotation.set(...r);
    o.castShadow = true; o.receiveShadow = true;
    return o;
  }
  const grp = (...k) => { const g = new THREE.Group(); k.forEach((c) => g.add(c)); return g; };
  const spinners = [], flags = [], agents = [], beams = [];
  const rng = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  function tree(R, kind) {
    kind = kind || ['pine', 'round', 'round', 'fruit'][Math.floor(R() * 4)];
    if (kind === 'pine') {
      const c = '#3f8f55';
      return grp(part(G.cyl, '#7a5236', [0.16, 0.8, 0.16], [0, 0.4, 0]), part(G.cone, c, [1, 1.3, 1], [0, 1.3, 0]), part(G.cone, c, [0.78, 1.1, 0.78], [0, 1.95, 0]), part(G.cone, c, [0.52, 0.9, 0.52], [0, 2.5, 0]));
    }
    if (kind === 'palm') {
      const g = grp(part(G.cyl, '#9b7a4c', [0.14, 2.6, 0.14], [0, 1.3, 0], [0, 0, 0.12]));
      for (let k = 0; k < 6; k++) { const p = grp(part(G.box, '#4caf50', [0.28, 0.06, 1.5], [0, 0, 0.7])); p.position.set(0.16, 2.6, 0); p.rotation.set(0.45, k * PI / 3, 0); g.add(p); }
      return g;
    }
    const g = grp(part(G.cyl, '#7a5236', [0.16, 1, 0.16], [0, 0.5, 0]), part(G.ico, R() > 0.5 ? '#5cb85c' : '#7cc35b', [1, 0.95, 1], [0, 1.55, 0]));
    if (kind === 'fruit') for (let k = 0; k < 5; k++) { const a = k * 1.3; g.add(part(G.sph, '#e0483e', [0.13, 0.13, 0.13], [Math.cos(a) * 0.85, 1.4 + (k % 2) * 0.4, Math.sin(a) * 0.85])); }
    return g;
  }
  function house(R) {
    const wall = ['#f4e3c3', '#efd5aa', '#f1d9d0', '#e8e2d0'][Math.floor(R() * 4)], roof = ['#c8553d', '#8a5a44', '#b8603a'][Math.floor(R() * 3)];
    return grp(part(G.box, wall, [1.8, 1.3, 1.6], [0, 0.65, 0]), part(G.roof, roof, [1.5, 0.95, 1.35], [0, 1.78, 0]), part(G.box, '#6b4a33', [0.42, 0.72, 0.06], [0, 0.36, 0.81]),
      part(G.box, winMat, [0.34, 0.34, 0.06], [-0.56, 0.82, 0.81]), part(G.box, winMat, [0.34, 0.34, 0.06], [0.56, 0.82, 0.81]), part(G.box, winMat, [0.06, 0.34, 0.34], [0.91, 0.82, 0]), part(G.box, '#8f8a80', [0.24, 0.6, 0.24], [0.5, 1.95, -0.3]));
  }
  function person(R, color) {
    const g = grp(part(G.cyl, color || ['#3d63dd', '#c8553d', '#7b4fb5', '#2f9e6b', '#d98e2b'][Math.floor(R() * 5)], [0.24, 0.75, 0.3], [0, 0.38, 0]), part(G.sph, '#e9b98d', [0.2, 0.2, 0.2], [0, 0.95, 0]), part(G.sph, '#3a2a20', [0.21, 0.12, 0.21], [0, 1.06, -0.02]));
    g.userData.person = true;
    return g;
  }
  const sheep = () => grp(part(G.ico, '#f7f5ef', [0.45, 0.4, 0.6], [0, 0.5, 0]), part(G.box, '#3b3b3b', [0.24, 0.26, 0.3], [0, 0.62, 0.58]), ...[[-0.2, 0.2], [0.2, 0.2], [-0.2, -0.25], [0.2, -0.25]].map(([x, z]) => part(G.box, '#3b3b3b', [0.09, 0.3, 0.09], [x, 0.15, z])));
  const rock = (R) => { const s = 0.35 + R() * 0.6; return grp(part(G.dod, R() > 0.5 ? '#9a998f' : '#8a8a80', [s, s * 0.75, s], [0, s * 0.3, 0], [R(), R(), R()])); };
  const flower = (R) => grp(part(G.cyl, '#4f8f3a', [0.03, 0.3, 0.03], [0, 0.15, 0]), part(G.sph, ['#ff8fb1', '#ffd23f', '#ffffff', '#b48cff'][Math.floor(R() * 4)], [0.13, 0.13, 0.13], [0, 0.32, 0]));
  function flag(color, h) {
    const piv = grp(part(G.box, color, [0.9, 0.55, 0.04], [0.45, 0, 0]));
    piv.position.y = h - 0.3; flags.push(piv);
    return grp(part(G.cyl, '#5d4a3a', [0.05, h, 0.05], [0, h / 2, 0]), piv);
  }
  const well = () => grp(part(G.cyl, '#a7a297', [0.85, 0.8, 0.85], [0, 0.4, 0]), part(G.cyl, '#2f6f8f', [0.7, 0.05, 0.7], [0, 0.81, 0]), part(G.box, '#7a5236', [0.1, 1.6, 0.1], [-0.7, 1.3, 0]), part(G.box, '#7a5236', [0.1, 1.6, 0.1], [0.7, 1.3, 0]), part(G.roof, '#8a5a44', [1.2, 0.6, 1.0], [0, 2.3, 0]), part(G.cyl, '#7a5236', [0.18, 0.25, 0.18], [0, 1.4, 0]));
  function windmill() {
    const blades = new THREE.Group();
    for (let k = 0; k < 4; k++) { const b = grp(part(G.box, '#f4efe4', [0.32, 2.6, 0.05], [0, 1.4, 0])); b.rotation.z = k * PI / 2; blades.add(b); }
    blades.position.set(0, 3.1, 0.95); spinners.push({ o: blades, ax: 'z', s: 1.4 });
    return grp(part(new THREE.CylinderGeometry(0.6, 1.05, 3.3, 8), '#efe6d6', [1, 1, 1], [0, 1.65, 0]), part(G.cone, '#a0522d', [1, 0.9, 1], [0, 3.75, 0]), part(G.box, winMat, [0.3, 0.4, 0.05], [0, 1.6, 0.85]), part(G.box, '#6b4a33', [0.5, 0.8, 0.06], [0, 0.4, 0.98]), part(G.sph, '#5d4a3a', [0.18, 0.18, 0.18], [0, 3.1, 0.95]), blades);
  }
  function lighthouse() {
    const g = grp(part(G.dod, '#8a8a80', [1.6, 0.8, 1.6], [0, 0.2, 0]));
    const cols = ['#f4f1ea', '#d6453a', '#f4f1ea', '#d6453a'];
    for (let k = 0; k < 4; k++) { const r1 = 0.9 - k * 0.11, r2 = 0.9 - (k + 1) * 0.11; g.add(part(new THREE.CylinderGeometry(r2, r1, 1.05, 10), cols[k], [1, 1, 1], [0, 0.9 + k * 1.05, 0])); }
    g.add(part(G.cyl, lampMat, [0.48, 0.65, 0.48], [0, 5.35, 0]), part(G.cone, '#d6453a', [0.62, 0.6, 0.62], [0, 5.95, 0]), part(G.cyl, '#3b3b3b', [0.62, 0.08, 0.62], [0, 5.02, 0]));
    const bg = new THREE.ConeGeometry(1.3, 10, 16, 1, true); bg.translate(0, -5, 0); bg.rotateZ(PI / 2);
    const beam = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beams.push(beam);
    const piv = grp(beam); piv.position.y = 5.35; spinners.push({ o: piv, ax: 'y', s: 0.9 }); g.add(piv);
    return g;
  }
  function gate() {
    const stone = '#dcc9a2';
    return grp(part(G.cyl, stone, [0.95, 4, 0.95], [-2.3, 2, 0]), part(G.cyl, stone, [0.95, 4, 0.95], [2.3, 2, 0]), part(G.cone, '#8a5a44', [1.15, 1.2, 1.15], [-2.3, 4.6, 0]), part(G.cone, '#8a5a44', [1.15, 1.2, 1.15], [2.3, 4.6, 0]),
      part(G.box, stone, [3.8, 2.8, 0.9], [0, 1.4, 0]), part(G.box, '#3d2f25', [1.3, 1.9, 0.95], [0, 0.95, 0]), part(G.box, winMat, [0.3, 0.4, 0.05], [-2.3, 2.6, 0.96]), part(G.box, winMat, [0.3, 0.4, 0.05], [2.3, 2.6, 0.96]), ...[-1.5, -0.5, 0.5, 1.5].map((x) => part(G.box, stone, [0.5, 0.45, 0.9], [x, 3.02, 0])));
  }
  function temple() {
    const g = grp(part(G.box, '#e8dfca', [5.4, 0.8, 5.4], [0, 0.1, 0]), part(G.box, '#f6efdc', [3.8, 2.4, 3.8], [0, 1.7, 0]),
      part(new THREE.SphereGeometry(1, 14, 8, 0, PI * 2, 0, PI / 2), mat('#f2c14e', { metalness: 0.45, roughness: 0.4, emissive: '#7a5200', emissiveIntensity: 0.25 }), [1.55, 1.55, 1.55], [0, 2.9, 0]), part(G.cone, '#f2c14e', [0.25, 0.9, 0.25], [0, 4.85, 0]));
    [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]].forEach(([x, z]) => g.add(part(G.cyl, '#f6efdc', [0.45, 3.6, 0.45], [x, 1.8, z]), part(G.cone, '#f2c14e', [0.6, 1.1, 0.6], [x, 4.15, z])));
    [[0, 1.5, 1.91], [-1.1, 1.5, 1.91], [1.1, 1.5, 1.91], [0, 1.5, -1.91]].forEach((p) => g.add(part(G.box, winMat, [0.42, 0.75, 0.06], p)));
    const f1 = flag('#3d63dd', 2.2); f1.position.set(-2.2, 4.4, -2.2);
    const f2 = flag('#d6453a', 2.2); f2.position.set(2.2, 4.4, 2.2);
    g.add(f1, f2);
    return g;
  }
  function dock() {
    const g = new THREE.Group();
    g.add(part(G.box, '#9b7a4c', [1.3, 0.14, 4.2], [0, 0.35, 2]));
    [[-0.55, 0.6], [0.55, 0.6], [-0.55, 3.6], [0.55, 3.6]].forEach(([x, z]) => g.add(part(G.cyl, '#6b4a33', [0.09, 1.4, 0.09], [x, -0.1, z])));
    return g;
  }

  /* ---------- placement ---------- */
  const placed = [];
  function spot(z, R, rMin, rMax, rad, o) {
    o = o || {};
    for (let k = 0; k < 90; k++) {
      const a = o.dir != null ? o.dir + (R() - 0.5) * (o.spread || 1.2) : R() * PI * 2, r = rMin + R() * (rMax - rMin);
      const x = z.x + Math.cos(a) * r, zz = z.z + Math.sin(a) * r;
      if (H(x, zz) < (o.minH != null ? o.minH : 0.62)) continue;
      if (roadDist(x, zz) < 1.25 + rad) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - zz) < p.r + rad)) continue;
      placed.push({ x, z: zz, r: rad });
      return [x, zz];
    }
    return null;
  }
  function put(z, obj, xz, scale, rotY, faceRoad) {
    if (!xz) return null;
    const [x, zz] = xz;
    obj.position.set(x, H(x, zz) - 0.05, zz);
    if (faceRoad) {
      let b = 0, bd = 1e9;
      for (let i = 0; i <= RN; i += 2) { const d = (roadPts[i].x - x) ** 2 + (roadPts[i].z - zz) ** 2; if (d < bd) { bd = d; b = i; } }
      obj.rotation.y = Math.atan2(roadPts[b].x - x, roadPts[b].z - zz);
    } else obj.rotation.y = rotY || 0;
    obj.userData.s = scale || 1;
    obj.userData.d = Math.hypot(x - z.x, zz - z.z);
    z.decor.push(obj);
    scene.add(obj);
    return obj;
  }
  const scatterTrees = (z, R, n, rMin, rMax, kind) => { for (let k = 0; k < n; k++) { const s = 0.75 + R() * 0.55; put(z, tree(R, kind), spot(z, R, rMin, rMax, 0.9 * s), s, R() * PI * 2); } };
  function wanderer(z, R, obj, speed, radius) {
    const a = put(z, obj, spot(z, R, 2, radius, 0.4), obj.userData.person ? 1.1 : 1, R() * PI * 2);
    if (a) agents.push({ o: a, z, R, speed, radius, tgt: null, wait: 0, ph: R() * 9 });
  }
  const BUILD = {
    garden(z, R) { put(z, tree(R, 'fruit'), spot(z, R, 3, 4.5, 1.6), 1.8, 0); scatterTrees(z, R, 12, 3, 11, 'fruit'); scatterTrees(z, R, 5, 5, 11); for (let k = 0; k < 26; k++) put(z, flower(R), spot(z, R, 1.6, 8, 0.25), 1, R() * 6); for (let k = 0; k < 3; k++) wanderer(z, R, sheep(), 0.5, 7); },
    well(z, R) { put(z, well(), spot(z, R, 2.8, 4, 1.3), 1, 0, true); wanderer(z, R, person(R, '#7b4fb5'), 0.8, 6); wanderer(z, R, person(R), 0.8, 6); scatterTrees(z, R, 9, 4, 11); for (let k = 0; k < 5; k++) put(z, rock(R), spot(z, R, 3, 10, 0.7), 1, R() * 6); },
    hills(z, R) { put(z, windmill(), spot(z, R, 3.5, 5, 1.6), 1.1, 0, true); for (let k = 0; k < 7; k++) wanderer(z, R, sheep(), 0.45, 9); wanderer(z, R, person(R, '#8a5a44'), 0.6, 7); scatterTrees(z, R, 7, 5, 11, 'pine'); for (let k = 0; k < 4; k++) put(z, rock(R), spot(z, R, 4, 10, 0.7), 1, R() * 6); },
    village(z, R) { for (let k = 0; k < 6; k++) put(z, house(R), spot(z, R, 2.6, 7.5, 1.5), 0.9 + R() * 0.25, 0, true); for (let k = 0; k < 5; k++) wanderer(z, R, person(R), 0.9, 7); scatterTrees(z, R, 8, 6, 12); put(z, flag('#f2c14e', 2.4), spot(z, R, 2, 4, 0.4), 1, 0); },
    shore(z, R) {
      const out = Math.atan2(z.z, z.x);
      put(z, lighthouse(), spot(z, R, 3, 5.5, 1.7, { dir: out, spread: 1.4, minH: 0.25 }), 1, 0);
      put(z, dock(), spot(z, R, 3, 6, 1.2, { dir: out + 0.9, spread: 0.8, minH: 0.15 }), 1, Math.atan2(Math.cos(out), Math.sin(out)));
      scatterTrees(z, R, 8, 2.5, 9, 'palm'); for (let k = 0; k < 6; k++) put(z, rock(R), spot(z, R, 3, 9, 0.7, { minH: 0.2 }), 1, R() * 6); wanderer(z, R, person(R, '#2f6f8f'), 0.7, 6);
    },
    gate(z, R) { put(z, gate(), spot(z, R, 3.2, 4.6, 2.6), 1, 0, true); for (let k = 0; k < 3; k++) put(z, house(R), spot(z, R, 5, 9, 1.5), 0.9, 0, true); for (let k = 0; k < 3; k++) wanderer(z, R, person(R), 0.9, 8); scatterTrees(z, R, 7, 5, 11); },
    summit(z, R) {
      const tx = 1.4, tz = -1.6;
      placed.push({ x: tx, z: tz, r: 3.6 });
      z.temple = put(z, temple(), [tx, tz], 1, -0.6);
      z.temple.position.y = H(tx, tz) - 0.45;
      scatterTrees(z, R, 7, 6, 10, 'pine'); for (let k = 0; k < 8; k++) put(z, flower(R), spot(z, R, 2, 7, 0.25), 1, 0); wanderer(z, R, person(R, '#f2c14e'), 0.7, 6);
    },
  };
  ZONES.forEach((z) => (BUILD[z.kind] || BUILD.garden)(z, rng(z.i * 977 + 31)));

  /* crystals + labels */
  const crystals = ZONES.map((z) => {
    const m = new THREE.MeshStandardMaterial({ color: '#bfe9ff', emissive: '#5fc8ff', emissiveIntensity: 1.1, flatShading: true, transparent: true, opacity: 0.92 });
    const oct = new THREE.Mesh(new THREE.OctahedronGeometry(0.75), m); oct.position.y = 2.3; oct.castShadow = true;
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.07, 6, 28), m); ringM.rotation.x = PI / 2; ringM.position.y = 0.2;
    const g = grp(oct, ringM); g.position.set(z.x, H(z.x, z.z), z.z); g.userData.oct = oct; scene.add(g);
    return g;
  });
  const lockSvg = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5" width="8" height="6" rx="1.5" fill="currentColor"/><path d="M4 5V3.6a2 2 0 0 1 4 0V5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';
  const tickSvg = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.4l2.3 2.3 4.7-5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>';
  const labels = ZONES.map(() => { const d = document.createElement('div'); d.className = 'rw-label'; root.appendChild(d); return d; });
  const labelPos = ZONES.map((z) => new V3(z.x, H(z.x, z.z) + (z.kind === 'summit' ? 7.5 : 4.4), z.z));

  /* hero */
  const hero = new THREE.Group();
  const heroBody = grp(part(G.cyl, theme.hero, [0.36, 1, 0.42], [0, 0.55, 0]), part(G.sph, '#e9b98d', [0.32, 0.32, 0.32], [0, 1.3, 0]), part(G.cone, theme.heroHat, [0.46, 0.55, 0.46], [0, 1.75, 0]),
    part(G.box, '#8a5a44', [0.5, 0.55, 0.28], [0, 0.75, -0.42]), part(G.cyl, '#7a5236', [0.05, 1.9, 0.05], [0.48, 0.95, 0.12]), part(G.sph, '#f2c14e', [0.11, 0.11, 0.11], [0.48, 1.92, 0.12]));
  hero.add(heroBody); hero.scale.setScalar(1.25); scene.add(hero);

  /* ambient: clouds, birds, boat, stars */
  const clouds = new THREE.Group(); scene.add(clouds);
  const cMat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, transparent: true, opacity: 0.95 });
  { const R = rng(7); for (let k = 0; k < 9; k++) { const c = new THREE.Group(); const n = 3 + Math.floor(R() * 3); for (let j = 0; j < n; j++) { const s = 1.4 + R() * 1.6; const m = new THREE.Mesh(G.ico, cMat); m.scale.set(s, s * 0.7, s); m.position.set(j * 1.6 - n * 0.8, R() * 0.6, (R() - 0.5) * 1.5); m.castShadow = true; c.add(m); } const a = (k / 9) * PI * 2, r = 12 + R() * 26; c.position.set(Math.cos(a) * r, 15 + R() * 5, Math.sin(a) * r); c.rotation.y = R() * PI; clouds.add(c); } }
  const birds = [];
  for (let k = 0; k < 6; k++) { const pl = grp(part(G.box, '#2e3440', [0.9, 0.05, 0.25], [-0.45, 0, 0])), pr = grp(part(G.box, '#2e3440', [0.9, 0.05, 0.25], [0.45, 0, 0])); const b = grp(pl, pr, part(G.box, '#2e3440', [0.18, 0.14, 0.5], [0, 0, 0])); b.userData = { pl, pr, r: 14 + k * 2.2, h: 11 + (k % 3), sp: 0.25 + k * 0.03, ph: k * 1.1 }; scene.add(b); birds.push(b); }
  const sail = new THREE.Shape(); sail.moveTo(0, 0); sail.lineTo(0, 2.4); sail.lineTo(1.5, 0); sail.lineTo(0, 0);
  const boat = grp(part(G.box, '#8a5a44', [1.1, 0.45, 2.6], [0, 0.15, 0]), part(G.cyl, '#5d4a3a', [0.06, 2.8, 0.06], [0, 1.6, 0.2]));
  { const s = new THREE.Mesh(new THREE.ShapeGeometry(sail), new THREE.MeshStandardMaterial({ color: '#fffaf0', side: THREE.DoubleSide, flatShading: true })); s.position.set(0, 0.6, 0.25); s.rotation.y = PI / 2; s.castShadow = true; boat.add(s); }
  scene.add(boat);
  const starG = new THREE.BufferGeometry();
  { const a = []; const R = rng(3); for (let k = 0; k < 700; k++) { const th = R() * PI * 2, ph = R() * PI * 0.42; a.push(Math.cos(th) * Math.sin(ph) * 200, Math.cos(ph) * 200, Math.sin(th) * Math.sin(ph) * 200); } starG.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); }
  const stars = new THREE.Points(starG, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
  scene.add(stars);

  /* particles */
  const parts = [], rings = [], pGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2), PM = {};
  const pm = (c) => PM[c] || (PM[c] = new THREE.MeshBasicMaterial({ color: c }));
  const PAL = ['#f2c14e', '#ff8a3d', '#5fc8ff', '#7ddc8a', '#ff6f91', '#ffffff'];
  function burst(p, n, power) {
    if (reduce) return;
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(pGeo, pm(PAL[k % PAL.length])); m.position.copy(p);
      const a = Math.random() * PI * 2, e = 0.35 + Math.random(), sp = power * (0.45 + Math.random() * 0.7);
      m.userData = { v: new V3(Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp * 1.25, Math.sin(a) * Math.cos(e) * sp), life: 1.3 + Math.random() * 0.8 };
      m.userData.max = m.userData.life; scene.add(m); parts.push(m);
    }
  }
  function ringWave(p, color) {
    if (reduce) return;
    const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    r.rotation.x = -PI / 2; r.position.copy(p).add(new V3(0, 0.35, 0)); scene.add(r); rings.push(r);
    const cleanup = () => { scene.remove(r); r.geometry.dispose(); r.material.dispose(); rings.splice(rings.indexOf(r), 1); };
    to(r.scale, { x: 11, y: 11, duration: 1.6, ease: 'power2.out' });
    to(r.material, { opacity: 0, duration: 1.6, ease: 'power1.in', onComplete: cleanup });
  }
  function floatText(p, txt) {
    if (!txt) return;
    const v = p.clone().project(camera);
    const el = document.createElement('div'); el.className = 'rw-float'; el.textContent = txt;
    el.style.left = ((v.x + 1) / 2) * root.clientWidth + 'px'; el.style.top = ((1 - v.y) / 2) * root.clientHeight + 'px';
    root.appendChild(el); later(() => el.remove(), 1600);
  }

  /* ---------- state ---------- */
  let cur = 0, walking = false, finished = false, night = opts.night ? 1 : 0, overview = false;
  function setHero(t) {
    const p = curve.getPoint(t), tn = curve.getTangent(t);
    hero.position.set(p.x, H(p.x, p.z), p.z); hero.rotation.y = Math.atan2(tn.x, tn.z);
    gold.geometry.setDrawRange(0, Math.floor(t * RN) * 6);
  }
  function lockZone(z) {
    z.unlocked = false; z.reveal = 0;
    z.decor.forEach((o) => { o.scale.setScalar(0.001); o.visible = false; });
    crystals[z.i].visible = true; crystals[z.i].scale.setScalar(1); paintZone(z.i);
  }
  function showZone(z, instant) {
    z.unlocked = true; crystals[z.i].visible = false;
    if (instant || reduce) { z.reveal = 1; paintZone(z.i); z.decor.forEach((o) => { o.visible = true; o.scale.setScalar(o.userData.s); }); return; }
    const dur = 2.4, speed = (zoneMax[z.i] + 3) / dur;
    to(z, { reveal: 1, duration: dur, ease: 'none', onUpdate: () => paintZone(z.i) });
    z.decor.forEach((o) => { o.visible = true; o.scale.setScalar(0.001); const s = o.userData.s; to(o.scale, { x: s, y: s, z: s, duration: 0.8, delay: o.userData.d / speed, ease: 'back.out(2.4)' }); });
  }
  function hud() {
    const z = ZONES[cur];
    $('eyebrow').textContent = finished ? 'Journey complete' : `Step ${cur + 1} of ${N}`;
    $('title').textContent = z.title;
    $('sub').textContent = finished ? `All ${N} steps done.` : z.subtitle;
    $('bar').style.width = ((finished ? N : cur) / N) * 100 + '%';
    $('regions').textContent = ZONES.filter((q) => q.unlocked).length + '/' + N + ' regions';
    $('go').disabled = walking || finished;
    labels.forEach((l, i) => {
      const q = ZONES[i], done = i < cur || finished;
      l.className = 'rw-label' + (q.unlocked ? (done ? ' rw-done' : '') : ' rw-locked');
      l.innerHTML = (q.unlocked ? (done ? tickSvg : '') : lockSvg);
      const s = document.createElement('span'); s.textContent = q.title; l.appendChild(s);
    });
  }
  const emit = (fn, ...a) => { try { fn && fn(...a); } catch (e) { console.error(e); } };

  /** Animate completing the current step: walk to the next region and unlock it. */
  function completeStep() {
    if (walking || finished) return false;
    const done = cur;
    floatText(hero.position.clone().add(new V3(0, 3, 0)), opts.rewardText(done));
    burst(hero.position.clone().add(new V3(0, 1.5, 0)), 24, 5);
    emit(opts.onStepComplete, done);
    if (cur === N - 1) { finished = true; hud(); finale(); return true; }
    walking = true; overview = false; syncViewBtn();
    const st = { t: cur / (N - 1) }, target = (cur + 1) / (N - 1);
    cur++; hud();
    to(st, { t: target, duration: reduce ? 0.01 : 3, delay: reduce ? 0 : 0.4, ease: 'power1.inOut', onUpdate: () => setHero(st.t), onComplete: () => { walking = false; arrive(ZONES[cur]); } });
    return true;
  }
  function arrive(z) {
    const c = crystals[z.i], p = c.position.clone().add(new V3(0, 2.3, 0));
    const open = () => { c.visible = false; burst(p, 70, 8); ringWave(c.position, '#5fc8ff'); showZone(z); floatText(p, z.title + ' unlocked'); hud(); emit(opts.onRegionUnlocked, z.i); };
    if (reduce) { open(); return; }
    to(c.scale, { x: 1.6, y: 1.6, z: 1.6, duration: 0.25, ease: 'power2.out', onComplete: open });
  }
  function finale() {
    const t = ZONES[N - 1].temple;
    if (!reduce && t) {
      const b = t.position.clone(); let k = 0;
      tw(gsap.fromTo(t.scale, { x: 1, y: 1, z: 1 }, { x: 1.12, y: 1.12, z: 1.12, duration: 0.3, yoyo: true, repeat: 1, ease: 'power2.out' }));
      const fire = () => { burst(b.clone().add(new V3((Math.random() - 0.5) * 10, 7 + Math.random() * 4, (Math.random() - 0.5) * 10)), 60, 7); if (++k < 9) later(fire, 320); };
      fire(); ringWave(b, '#f2c14e');
    }
    $('banner').classList.add('rw-show'); later(() => $('banner').classList.remove('rw-show'), 2800);
    overview = true; syncViewBtn();
    emit(opts.onFinish);
  }
  /** Jump straight to a state without animation. `completed` = number of steps already finished. */
  function setProgress(completed) {
    killAll();
    rings.splice(0).forEach((r) => scene.remove(r));
    parts.splice(0).forEach((p) => scene.remove(p));
    $('banner').classList.remove('rw-show');
    completed = Math.max(0, Math.min(N, completed | 0));
    finished = completed >= N; walking = false;
    cur = Math.min(completed, N - 1);
    ZONES.forEach((z, i) => (i <= cur ? showZone(z, true) : lockZone(z)));
    setHero(cur / (N - 1));
    if (finished) gold.geometry.setDrawRange(0, RN * 6);
    hud();
  }
  function setNight(on) { $('night').textContent = on ? 'Day' : 'Night'; const s = { v: night }; to(s, { v: on ? 1 : 0, duration: reduce ? 0.01 : 1.6, ease: 'power2.inOut', onUpdate: () => (night = s.v) }); }
  function setOverview(on) { overview = !!on; syncViewBtn(); }
  function syncViewBtn() { $('view').textContent = overview ? 'Follow' : 'Overview'; }

  $('go').addEventListener('click', completeStep);
  $('reset').addEventListener('click', () => setProgress(0));
  $('night').addEventListener('click', () => setNight(night < 0.5));
  $('view').addEventListener('click', () => setOverview(!overview));

  /* ---------- camera controls: drag to rotate, wheel or pinch to zoom ---------- */
  let az = -0.35, pol = 0.98, dist = 30, curDist = 30, lastInput = 0, userZoom = false;
  const target = new V3(), pointers = new Map();
  let pinch = 0;
  cvs.addEventListener('pointerdown', (e) => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); lastInput = performance.now(); try { cvs.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } });
  cvs.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId); if (!prev) return;
    if (pointers.size === 1) {
      az -= (e.clientX - prev.x) * 0.006;
      pol = Math.min(1.35, Math.max(0.45, pol - (e.clientY - prev.y) * 0.004));
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) { dist = Math.min(55, Math.max(14, dist * (pinch / d))); userZoom = true; }
      pinch = d;
    }
    lastInput = performance.now();
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; };
  cvs.addEventListener('pointerup', up); cvs.addEventListener('pointercancel', up);
  cvs.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.min(55, Math.max(14, dist * (1 + Math.sign(e.deltaY) * 0.08))); userZoom = true; lastInput = performance.now(); }, { passive: false });

  function resize() {
    const w = root.clientWidth || 1, h = root.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!userZoom) dist = w < 560 ? 36 : 30;
  }
  const ro = new ResizeObserver(resize); ro.observe(root); resize();

  /* ---------- loop ---------- */
  setProgress(opts.progress || 0);
  if (opts.night) setNight(true);
  target.copy(hero.position);
  let raf = 0, last = performance.now();
  const tmpC = new THREE.Color(), want = new V3(), lp = new V3();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05), t = now / 1000; last = now;
    if (!reduce && pointers.size === 0 && now - lastInput > 7000 && !walking) az += dt * 0.05;
    if (overview) want.set(0, 1.5, 0); else want.copy(hero.position).multiplyScalar(0.72).add(new V3(0, 1.2, 0));
    target.lerp(want, 1 - Math.exp(-dt * 3));
    curDist += ((overview ? Math.max(dist * 2, 62) : dist) - curDist) * (1 - Math.exp(-dt * 2.5));
    camera.position.set(target.x + curDist * Math.sin(pol) * Math.sin(az), target.y + curDist * Math.cos(pol), target.z + curDist * Math.sin(pol) * Math.cos(az));
    camera.lookAt(target);
    heroBody.position.y = walking ? Math.abs(Math.sin(t * 11)) * 0.22 : Math.sin(t * 2) * 0.03;
    heroBody.rotation.z = walking ? Math.sin(t * 11) * 0.06 : 0;
    const m = reduce ? 0 : 1;
    if (m) { const a = wg.attributes.position; for (let i = 0; i < a.count; i++) { const x = wBase[i * 3], z = wBase[i * 3 + 2]; a.setY(i, Math.sin(x * 0.18 + t * 1.1) * 0.13 + Math.cos(z * 0.21 + t * 0.9) * 0.11); } a.needsUpdate = true; }
    spinners.forEach((s) => { s.o.rotation[s.ax] += dt * s.s * m; });
    flags.forEach((f, i) => { f.rotation.y = Math.sin(t * 3 + i) * 0.35 * m; });
    clouds.rotation.y += dt * 0.012 * m;
    birds.forEach((b) => { const u = b.userData, a = t * u.sp * m + u.ph; b.position.set(Math.cos(a) * u.r, u.h + Math.sin(t + u.ph) * 0.6, Math.sin(a) * u.r); b.rotation.y = -a; const f = Math.sin(t * 9 + u.ph) * 0.5 * m; u.pl.rotation.z = f; u.pr.rotation.z = -f; });
    { const a = t * 0.05 * m + 1, r = 37; boat.position.set(Math.cos(a) * r, Math.sin(t * 1.4) * 0.12 - 0.05, Math.sin(a) * r); boat.rotation.y = -a; boat.rotation.z = Math.sin(t * 1.2) * 0.05; }
    crystals.forEach((c, i) => { const o = c.userData.oct; o.rotation.y += dt * 1.2; o.position.y = 2.3 + Math.sin(t * 2 + i) * 0.2; });
    agents.forEach((g) => {
      const o = g.o; if (!g.z.unlocked || o.scale.x < 0.5 || reduce) return;
      if (!g.tgt || Math.hypot(g.tgt[0] - o.position.x, g.tgt[1] - o.position.z) < 0.3) {
        if (g.wait > 0) { g.wait -= dt; return; }
        const a = g.R() * PI * 2, r = 1.5 + g.R() * (g.radius - 1.5), x = g.z.x + Math.cos(a) * r, z = g.z.z + Math.sin(a) * r;
        if (H(x, z) > 0.62 && roadDist(x, z) > 1.1) g.tgt = [x, z];
        g.wait = g.R() * 2.5; return;
      }
      const dx = g.tgt[0] - o.position.x, dz = g.tgt[1] - o.position.z, d = Math.hypot(dx, dz), s = Math.min(d, g.speed * dt);
      o.position.x += (dx / d) * s; o.position.z += (dz / d) * s;
      o.position.y = H(o.position.x, o.position.z) - 0.05 + Math.abs(Math.sin(t * 8 + g.ph)) * 0.08;
      const ry = Math.atan2(dx, dz); o.rotation.y += ((((ry - o.rotation.y + PI * 3) % (PI * 2)) - PI)) * Math.min(1, dt * 6);
    });
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i], u = p.userData; u.life -= dt;
      if (u.life <= 0) { scene.remove(p); parts.splice(i, 1); continue; }
      u.v.y -= 9 * dt; p.position.addScaledVector(u.v, dt); p.rotation.x += dt * 6; p.rotation.y += dt * 4; p.scale.setScalar(Math.min(1, (u.life / u.max) * 1.6));
    }
    tmpC.lerpColors(DAY.sky, NIGHT.sky, night); scene.background.copy(tmpC); scene.fog.color.copy(tmpC);
    hemi.color.lerpColors(DAY.hs, NIGHT.hs, night); hemi.groundColor.lerpColors(DAY.hg, NIGHT.hg, night); hemi.intensity = DAY.hi + (NIGHT.hi - DAY.hi) * night;
    sun.color.lerpColors(DAY.sun, NIGHT.sun, night); sun.intensity = DAY.si + (NIGHT.si - DAY.si) * night;
    winMat.emissiveIntensity = night * 2.2; lampMat.emissiveIntensity = 0.3 + night * 2.5; beams.forEach((b) => (b.material.opacity = night * 0.32));
    stars.material.opacity = night; cMat.opacity = 0.95 - night * 0.35;
    root.style.background = '#' + tmpC.getHexString();
    const w = root.clientWidth, h = root.clientHeight;
    labelPos.forEach((p, i) => {
      const v = lp.copy(p).project(camera), l = labels[i];
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { l.style.display = 'none'; return; }
      l.style.display = 'flex'; l.style.transform = `translate(${((v.x + 1) / 2) * w}px,${((1 - v.y) / 2) * h}px) translate(-50%,-100%)`;
    });
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function destroy() {
    cancelAnimationFrame(raf); killAll(); ro.disconnect();
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    Object.values(MC).forEach((m) => m.dispose());
    renderer.dispose(); root.remove();
  }

  return {
    completeStep,
    setProgress,
    setNight,
    setOverview,
    reset: () => setProgress(0),
    destroy,
    get state() { return { current: cur, completed: finished ? N : cur, total: N, finished, walking }; },
  };
}

function stubApi(root) {
  const noop = () => false;
  return { completeStep: noop, setProgress: noop, setNight: noop, setOverview: noop, reset: noop, destroy: () => root.remove(), get state() { return null; } };
}

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.textContent = `
.rw-stage{position:relative;width:100%;height:100%;overflow:hidden;background:#9fd6f5;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;font-family:inherit}
.rw-stage canvas{display:block;width:100%;height:100%;cursor:grab}
.rw-stage [hidden]{display:none!important}
.rw-hud{position:absolute;z-index:3;color:#16231d}
.rw-quest{top:12px;left:12px;width:min(300px,calc(100% - 24px));background:rgba(255,255,255,.9);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-radius:16px;padding:12px 14px;display:grid;gap:4px;box-shadow:0 6px 24px rgba(0,0,0,.12)}
.rw-eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#596a61}
.rw-title{font-size:18px;line-height:1.2}
.rw-sub{font-size:14px;color:#596a61}
.rw-bar{height:9px;border-radius:99px;background:#e5ede7;overflow:hidden;margin-top:4px}
.rw-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--rw-accent),var(--rw-gold));border-radius:99px;transition:width .8s cubic-bezier(.3,1.4,.5,1)}
.rw-stats{top:12px;right:12px}
.rw-pill{display:inline-block;background:rgba(255,255,255,.9);border-radius:99px;padding:6px 12px;font-weight:700;font-size:13px;font-variant-numeric:tabular-nums;box-shadow:0 4px 14px rgba(0,0,0,.1)}
.rw-controls{left:12px;right:12px;bottom:12px;display:flex;gap:8px;flex-wrap:wrap}
.rw-controls button{font:600 15px/1 inherit;font-family:inherit;border:0;border-radius:14px;padding:11px 15px;cursor:pointer;color:#fff;background:var(--rw-accent);box-shadow:0 4px 0 var(--rw-accent-deep)}
.rw-controls button:active{transform:translateY(3px);box-shadow:0 1px 0 var(--rw-accent-deep)}
.rw-controls button.rw-ghost{background:rgba(255,255,255,.9);color:#16231d;box-shadow:0 4px 0 rgba(0,0,0,.18)}
.rw-controls button:disabled{opacity:.55;cursor:default}
.rw-controls button:focus-visible{outline:3px solid var(--rw-gold);outline-offset:2px}
@media (max-width:480px){.rw-quest{width:calc(100% - 128px)}.rw-title{font-size:16px}}
.rw-label{position:absolute;left:0;top:0;z-index:1;pointer-events:none;font-weight:600;font-size:12px;white-space:nowrap;padding:4px 9px;border-radius:99px;background:rgba(255,255,255,.92);color:#16231d;box-shadow:0 3px 10px rgba(0,0,0,.15);display:flex;gap:5px;align-items:center}
.rw-label.rw-locked{background:rgba(40,52,46,.78);color:#e7efe9}
.rw-label.rw-done{background:var(--rw-accent);color:#fff}
.rw-label svg{width:11px;height:11px}
.rw-float{position:absolute;z-index:2;pointer-events:none;font-weight:700;font-size:20px;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.35),0 0 12px rgba(242,182,50,.8);transform:translate(-50%,-50%);animation:rw-rise 1.5s ease-out forwards;white-space:nowrap}
@keyframes rw-rise{from{opacity:0;margin-top:10px}15%{opacity:1}to{opacity:0;margin-top:-70px}}
.rw-banner{position:absolute;inset:0;z-index:4;display:grid;place-items:center;pointer-events:none}
.rw-banner div{font-weight:700;font-size:clamp(26px,6vw,46px);color:#fff;text-align:center;padding:0 16px;text-shadow:0 4px 0 rgba(0,0,0,.3),0 0 30px rgba(242,182,50,.9);transform:scale(.4);opacity:0;transition:transform .7s cubic-bezier(.3,1.6,.5,1),opacity .4s}
.rw-banner.rw-show div{transform:scale(1);opacity:1}
.rw-fallback{position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:#16231d;font-weight:600}
@media (prefers-reduced-motion:reduce){.rw-float,.rw-banner div,.rw-bar i{animation:none;transition:none}}`;
  document.head.appendChild(s);
}
