// Scene, camera, controls, render loop and picking.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PARTS, SYSTEMS } from './parts.js';
import { buildRocket, ROCKET_HEIGHT } from './rocket.js';
import { createUI } from './ui.js';

const PART = new Map(PARTS.map((p) => [p.id, p]));
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const GHOST_OPACITY = 0.12; // outer skins in the inside view
const FADE_TIME = 0.4; // seconds for the outside/inside fade
const DIM = 0.35; // brightness of parts that are not highlighted
const HIGHLIGHT_INTENSITY = 0.6;
const SEPARATION_TIME = 4; // seconds for the whole separation sequence
const PHASE_B = 1 / 3; // start of step b (first stage drops)
const PHASE_C = 2 / 3; // start of step c (fairing opens)
const IDLE_RESUME_MS = 3000;
const ROTATE_SPEED = 1.1; // about one turn a minute
const HOME = { azimuth: 0.55, polar: 1.4 };

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionQuery.matches;

const state = {
  view: 'outside',
  sepT: 0,
  sepDir: 0,
  separated: false,
  autoRotate: !reducedMotion,
  hovered: null, // part under the mouse
  pinned: null, // part fixed by a click or tap
  preview: null, // { type: 'part' | 'system', id } from the parts list or legend
  dragging: false,
  lastActivity: 0,
  pointer: { x: 0, y: 0, inside: false, mouse: false, dirty: false },
};

const ui = createUI({
  onViewChange: (view) => setView(view),
  onSeparateToggle: () => toggleSeparation(),
  onAutoRotateToggle: () => {
    state.autoRotate = !state.autoRotate;
    ui.setAutoRotate(state.autoRotate);
  },
  onResetView: () => resetView(),
  onPartPreview: (id) => {
    if (id) {
      ensureVisible(id);
      state.preview = { type: 'part', id };
    } else if (state.preview?.type === 'part') {
      state.preview = null;
    }
    touch();
    refresh();
  },
  onPartSelect: (id) => {
    ensureVisible(id);
    state.pinned = id;
    ui.hideHint();
    touch();
    refresh(true);
  },
  onSystemPreview: (id) => {
    if (id) state.preview = { type: 'system', id };
    else if (state.preview?.type === 'system') state.preview = null;
    touch();
    refresh();
  },
  onCardClose: () => unpin(),
  onEscape: () => {
    if (ui.partsOpen) ui.closeParts(true);
    else if (state.pinned) unpin();
  },
});
ui.setAutoRotate(state.autoRotate);
ui.setProgress(0.3);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('scene'),
    antialias: true,
    powerPreference: 'high-performance',
  });
} catch (err) {
  ui.showError();
  throw err;
}
const canvas = renderer.domElement;
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(dpr());
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 500);

// ---------------------------------------------------------------------------
// Background: deep navy to black radial gradient with one faint nebula glow.
// Painted per pixel so the tone mapping can be undone on these dark values
// (the colours on screen then match the design) and lightly dithered so the
// gradient does not band.
// ---------------------------------------------------------------------------
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function paintBackground(w, h) {
  const scale = Math.min(1, 1100 / Math.max(w, h));
  const cw = Math.max(4, Math.round(w * scale));
  const ch = Math.max(4, Math.round(h * scale));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(cw / 2, ch * 0.45, 0, cw / 2, ch * 0.45, Math.hypot(cw, ch) * 0.55);
  grad.addColorStop(0, '#0b1026');
  grad.addColorStop(1, '#05070f');
  g.fillStyle = grad;
  g.fillRect(0, 0, cw, ch);
  const nr = Math.min(cw, ch) * 0.42;
  g.save();
  g.translate(cw * 0.3, ch * 0.32);
  g.rotate(-0.45);
  g.scale(1.7, 1);
  const neb = g.createRadialGradient(0, 0, 0, 0, 0, nr);
  neb.addColorStop(0, 'rgba(98, 86, 196, 0.15)');
  neb.addColorStop(0.45, 'rgba(58, 92, 186, 0.07)');
  neb.addColorStop(1, 'rgba(40, 60, 160, 0)');
  g.fillStyle = neb;
  g.beginPath();
  g.arc(0, 0, nr, 0, TAU);
  g.fill();
  g.restore();

  const img = g.getImageData(0, 0, cw, ch);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = srgbToLinear(d[i] / 255);
    const gg = srgbToLinear(d[i + 1] / 255);
    const b = srgbToLinear(d[i + 2] / 255);
    // Neutral tone mapping subtracts (x - 6.25 x^2) where x is the darkest
    // channel; add back what it will take away.
    const m = Math.min(r, gg, b);
    const add = 0.4 * Math.sqrt(m) - m;
    const n = (Math.random() - 0.5) * 0.9;
    d[i] = Math.round(linearToSrgb(r + add) * 255 + n);
    d[i + 1] = Math.round(linearToSrgb(gg + add) * 255 + n);
    d[i + 2] = Math.round(linearToSrgb(b + add) * 255 + n);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Starfield: about 3,000 points in three sizes with a very slow twinkle.
// ---------------------------------------------------------------------------
function makeStars(count = 3000) {
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const bright = new Float32Array(count);
  const phase = new Float32Array(count);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * TAU;
    const s = Math.sqrt(1 - u * u);
    const r = 90 + Math.random() * 90;
    pos[i * 3] = r * s * Math.cos(th);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(th);
    const roll = Math.random();
    const tier = roll < 0.72 ? 0 : roll < 0.95 ? 1 : 2;
    size[i] = [1.6, 2.4, 3.6][tier];
    bright[i] = [0.5, 0.75, 1][tier];
    phase[i] = Math.random();
    c.setHSL(Math.random() < 0.15 ? 0.09 : 0.6, 0.4 * Math.random(), 0.82 + 0.18 * Math.random());
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: dpr() } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aBright;
      attribute float aPhase;
      attribute vec3 aColor;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float speed = 0.25 + fract(aPhase * 7.31) * 0.45;
        float tw = 0.72 + 0.28 * sin(uTime * speed + aPhase * 6.2831);
        vAlpha = aBright * tw;
        vColor = aColor;
        gl_PointSize = aSize * uPixelRatio;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d);
        a *= a * vAlpha;
        gl_FragColor = vec4(vColor * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------
let rocket;
let controls;
let composer;
let outline;
let stars;
const lights = {};
const fits = { assembled: null, separated: null };
let layout = { W: innerWidth, H: innerHeight, top: 0, bottom: 0, freeH: innerHeight };
let engineGlow = 0;
const highlightColor = new THREE.Color();
let highlightParts = new Set();
let cardKey = '';

function makeComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: dpr() >= 2 ? 2 : 4,
  });
  const c = new EffectComposer(renderer, target);
  c.addPass(new RenderPass(scene, camera));
  outline = new OutlinePass(new THREE.Vector2(innerWidth, innerHeight), scene, camera);
  outline.edgeStrength = 4;
  outline.edgeGlow = 0.6;
  outline.edgeThickness = 1.6;
  outline.pulsePeriod = 0;
  // Ghosted skins and fading meshes must not hide the edges of the part
  // inside them, so they sit out the outline pass.
  const renderOutline = outline.render.bind(outline);
  outline.render = (...args) => {
    if (outline.selectedObjects.length === 0) return renderOutline(...args);
    const hidden = [];
    for (const m of rocket.meshes) {
      if (m.visible && m.userData.opacity < 0.99) {
        m.visible = false;
        hidden.push(m);
      }
    }
    renderOutline(...args);
    for (const m of hidden) m.visible = true;
  };
  c.addPass(outline);
  c.addPass(new OutputPass());
  return c;
}

// ---------------------------------------------------------------------------
// Layout and framing
// ---------------------------------------------------------------------------
let viewShift = 0; // extra upward slide of the picture (CSS px), for the bottom sheet
let viewShiftTarget = 0;

function updateLayout() {
  const W = canvas.clientWidth || innerWidth;
  const H = canvas.clientHeight || innerHeight;
  if (!W || !H) return; // not laid out yet (hidden tab); the resize event will follow
  const { top, bottom } = ui.insets();
  layout = { W, H, top, bottom, freeH: Math.max(120, H - top - bottom) };
  camera.aspect = W / H;
  applyViewOffset();
  renderer.setPixelRatio(dpr());
  renderer.setSize(W, H, false);
  composer.setPixelRatio(dpr());
  composer.setSize(W, H);
  stars.material.uniforms.uPixelRatio.value = dpr();
}

// Shift the projection so the rocket sits in the middle of the free space
// between the header and the bottom controls (plus any slide for the sheet).
function applyViewOffset() {
  const { W, H, top, bottom } = layout;
  camera.setViewOffset(W, H, 0, -(top - bottom) / 2 + viewShift, W, H);
  camera.updateProjectionMatrix();
}

function updateViewShift(dt) {
  if (Math.abs(viewShiftTarget - viewShift) < 0.5) return;
  const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 8);
  viewShift += (viewShiftTarget - viewShift) * k;
  applyViewOffset();
}

// On phones the card is a bottom sheet. When a part is selected, slide the
// picture so the part sits in the free space above the sheet.
function fitAboveSheet(id, sticky) {
  const sheet = ui.sheetRect();
  if (!sheet || !sticky) {
    viewShiftTarget = 0;
    return;
  }
  const rect = partRect(id);
  if (!rect) return;
  const freeTop = layout.top;
  const freeBottom = sheet.top - 8;
  if (rect.top >= freeTop && rect.bottom <= freeBottom) return;
  const delta = (rect.top + rect.bottom) / 2 - (freeTop + freeBottom) / 2;
  viewShiftTarget = THREE.MathUtils.clamp(viewShift + delta, -layout.H * 0.45, layout.H * 0.45);
}

function boundsAt(t) {
  applySeparation(t);
  rocket.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rocket.root);
  return box;
}

function fitFor(box) {
  const { W, H, freeH } = layout;
  const height = box.max.y - box.min.y;
  const radial = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);
  const tanV = Math.tan((camera.fov * DEG) / 2);
  const pad = 18;
  const dH = (height / 2 / tanV) * (H / Math.max(80, freeH - pad * 2));
  const dW = (radial / (tanV * camera.aspect)) * (W / Math.max(80, W - pad * 2));
  return {
    distance: Math.max(dH, dW) + radial * 0.35,
    center: new THREE.Vector3(0, (box.min.y + box.max.y) / 2, 0),
  };
}

function computeFits() {
  const t = state.sepT;
  fits.assembled = fitFor(boundsAt(0));
  fits.separated = fitFor(boundsAt(1));
  applySeparation(t);
  rocket.root.updateMatrixWorld(true);
}

function currentFit() {
  return state.separated ? fits.separated : fits.assembled;
}

function placeCamera(target, radius, azimuth, polar) {
  controls.target.copy(target);
  const s = new THREE.Spherical(radius, polar, azimuth);
  camera.position.setFromSpherical(s).add(target);
  camera.lookAt(target);
}

let resizeTimer = 0;
function onResize() {
  const before = currentFit().distance;
  const radius = camera.position.distanceTo(controls.target);
  updateLayout();
  computeFits();
  const after = currentFit().distance;
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, (radius * after) / before);
  controls.minDistance = fits.assembled.distance * 0.3;
  controls.maxDistance = Math.max(fits.assembled.distance, fits.separated.distance) * 1.7;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const old = scene.background;
    scene.background = paintBackground(layout.W, layout.H);
    old?.dispose();
  }, 200);
}
addEventListener('resize', onResize);

// ---------------------------------------------------------------------------
// Camera tweens (reset view, framing during separation)
// ---------------------------------------------------------------------------
let tween = null;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;

function tweenCamera({ target, radius, azimuth, polar }, duration) {
  const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const from = { target: controls.target.clone(), radius: s.radius, theta: s.theta, phi: s.phi };
  const to = {
    target: (target ?? from.target).clone(),
    radius: radius ?? from.radius,
    theta: azimuth ?? from.theta,
    phi: polar ?? from.phi,
  };
  const d = to.theta - from.theta;
  to.theta = from.theta + Math.atan2(Math.sin(d), Math.cos(d));
  if (reducedMotion || !duration) {
    placeCamera(to.target, to.radius, to.theta, to.phi);
    tween = null;
    return;
  }
  tween = { from, to, t: 0, duration };
}

function updateTween(dt) {
  if (!tween) return;
  tween.t = Math.min(1, tween.t + dt / tween.duration);
  const e = ease(tween.t);
  const { from, to } = tween;
  const target = from.target.clone().lerp(to.target, e);
  placeCamera(
    target,
    THREE.MathUtils.lerp(from.radius, to.radius, e),
    THREE.MathUtils.lerp(from.theta, to.theta, e),
    THREE.MathUtils.lerp(from.phi, to.phi, e),
  );
  if (tween.t === 1) tween = null;
}

function resetView() {
  unpin();
  const fit = currentFit();
  tweenCamera({ target: fit.center, radius: fit.distance, azimuth: HOME.azimuth, polar: HOME.polar }, 0.9);
  touch();
}

// ---------------------------------------------------------------------------
// Views: which meshes are solid, ghosted or hidden
// ---------------------------------------------------------------------------
function targetOpacity(m, view = state.view) {
  const { layer, reveal } = m.userData;
  if (layer === 'solid') return 1;
  if (layer === 'skin') return view === 'inside' ? GHOST_OPACITY : 1;
  if (view === 'inside') return 1;
  if (reveal === 'b' && state.sepT > PHASE_B) return 1;
  if (reveal === 'c' && state.sepT > PHASE_C) return 1;
  return 0;
}

// Hoverable only when visible and fully opaque right now.
const isHoverable = (m) => m.visible && m.userData.opacity >= 0.99;

function partShownIn(id, view) {
  return rocket.byPart.get(id).some((m) => targetOpacity(m, view) >= 0.99);
}

function ensureVisible(id) {
  if (partShownIn(id, state.view)) return;
  const other = state.view === 'outside' ? 'inside' : 'outside';
  if (partShownIn(id, other)) setView(other);
}

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  ui.setView(view);
  // A pinned part that cannot be seen in the new view is released.
  if (state.pinned && !partShownIn(state.pinned, view)) state.pinned = null;
  refresh(true);
}

// ---------------------------------------------------------------------------
// Highlight and info card
// ---------------------------------------------------------------------------
function activeHighlight() {
  if (state.preview) return state.preview;
  if (state.pinned) return { type: 'part', id: state.pinned };
  if (state.hovered) return { type: 'part', id: state.hovered };
  return null;
}

function refresh(force = false) {
  const h = activeHighlight();
  highlightParts = new Set();
  if (h?.type === 'part') highlightParts.add(h.id);
  if (h?.type === 'system') for (const p of PARTS) if (p.system === h.id) highlightParts.add(p.id);
  if (h) {
    const color = SYSTEMS[h.type === 'part' ? PART.get(h.id).system : h.id].color;
    highlightColor.set(color);
    outline.visibleEdgeColor.set(color);
    outline.hiddenEdgeColor.set(color).multiplyScalar(0.5);
  }
  if (h?.type === 'part') {
    const pinned = !state.preview && state.pinned === h.id;
    const key = `${h.id}|${pinned}`;
    if (key !== cardKey || force) {
      cardKey = key;
      scene.updateMatrixWorld();
      const usePointer = h.id === state.hovered && !pinned && !state.preview && state.pointer.mouse;
      ui.showCard(h.id, { rect: partRect(h.id), pointer: usePointer ? state.pointer : null }, pinned);
      fitAboveSheet(h.id, pinned || !!state.preview);
    }
  } else if (cardKey) {
    cardKey = '';
    ui.hideCard();
    viewShiftTarget = 0;
  }
}

function unpin() {
  if (!state.pinned) return;
  state.pinned = null;
  touch();
  refresh();
}

const _box = new THREE.Box3();
const _v = new THREE.Vector3();
// Screen rectangle (CSS pixels) covered by the visible meshes of a part.
function partRect(id) {
  const rect = canvas.getBoundingClientRect();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of rocket.byPart.get(id)) {
    if (targetOpacity(m) < 0.99) continue;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    _box.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z);
      _v.project(camera);
      const x = rect.left + ((_v.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - _v.y) / 2) * rect.height;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX === Infinity) return null;
  return { left: minX, top: minY, right: maxX, bottom: maxY };
}

function updateMeshes(dt) {
  const fade = reducedMotion ? 1 : dt / FADE_TIME;
  const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 14);
  const active = highlightParts.size > 0;
  const selected = [];
  for (const m of rocket.meshes) {
    const u = m.userData;
    const mat = m.material;
    const target = targetOpacity(m);
    if (u.opacity < target) u.opacity = Math.min(target, u.opacity + fade);
    else if (u.opacity > target) u.opacity = Math.max(target, u.opacity - fade);
    m.visible = u.opacity > 0.005;
    const transparent = u.opacity < 0.999;
    if (mat.transparent !== transparent) {
      mat.transparent = transparent;
      mat.needsUpdate = true;
    }
    mat.opacity = u.opacity;
    mat.depthWrite = u.opacity > 0.6;

    const on = highlightParts.has(u.partId);
    if (on) u.hlColor.copy(highlightColor);
    u.hl += ((on ? 1 : 0) - u.hl) * k;
    u.dim += ((active && !on ? 1 : 0) - u.dim) * k;
    u.glow = u.partId === 'upper-stage-engine' ? engineGlow * 0.5 : 0;
    // Blending happens in linear light, where 12 % white already reads as a
    // light grey, so ghosted skins are also darkened to stay faint glass.
    const ghost = u.layer === 'skin' ? clamp01((1 - u.opacity) / (1 - GHOST_OPACITY)) : 0;
    const f = (1 - (1 - DIM) * u.dim) * (1 - 0.6 * ghost);
    const b = u.base;
    mat.color.copy(b.color).multiplyScalar(f).lerp(u.hlColor, u.hl * 0.22);
    mat.emissive.copy(b.emissive).multiplyScalar(f).lerp(u.hlColor, u.hl);
    mat.emissiveIntensity = THREE.MathUtils.lerp(b.emissiveIntensity * f, HIGHLIGHT_INTENSITY, u.hl) + u.glow;
    if (on && isHoverable(m)) selected.push(m);
  }
  outline.selectedObjects = selected;
}

// ---------------------------------------------------------------------------
// Stage separation
// ---------------------------------------------------------------------------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const phase = (t, a, b) => clamp01((t - a) / (b - a));

function applySeparation(t) {
  const a = phase(t, 0, PHASE_B);
  const b = phase(t, PHASE_B, PHASE_C);
  const c = phase(t, PHASE_C, 1);
  const { boosters, first, halves } = rocket.assemblies;
  // (a) boosters peel away outwards and fall
  boosters.forEach(({ pivot }, i) => {
    const sx = i === 0 ? 1 : -1;
    const peel = easeOut(a);
    const home = pivot.userData.home;
    pivot.rotation.z = -sx * 0.42 * peel;
    pivot.position.set(home.x + sx * 0.8 * peel, home.y - 2.1 * a * a, 0);
  });
  // (b) first stage and interstage drop, upper-stage engine glows
  first.position.y = -1.9 * ease(b);
  engineGlow = ease(b);
  rocket.engineLight.intensity = 1.4 * engineGlow;
  // (c) fairing halves and nose swing open and drift apart
  halves.forEach(({ pivot }, i) => {
    const sx = i === 0 ? 1 : -1;
    const e = ease(c);
    const home = pivot.userData.home;
    pivot.rotation.z = -sx * 0.62 * e;
    pivot.position.set(home.x + sx * 0.45 * e, home.y + 0.25 * e, 0);
  });
}

function toggleSeparation() {
  state.separated = !state.separated;
  ui.setSeparated(state.separated);
  const from = state.separated ? fits.assembled : fits.separated;
  const to = currentFit();
  const radius = camera.position.distanceTo(controls.target) * (to.distance / from.distance);
  if (reducedMotion) {
    state.sepT = state.separated ? 1 : 0;
    state.sepDir = 0;
    applySeparation(state.sepT);
    tweenCamera({ target: to.center, radius }, 0);
  } else {
    state.sepDir = state.separated ? 1 : -1;
    tweenCamera({ target: to.center, radius }, SEPARATION_TIME * 0.8);
  }
  touch();
}

function updateSeparation(dt) {
  if (!state.sepDir) return;
  state.sepT = clamp01(state.sepT + (state.sepDir * dt) / SEPARATION_TIME);
  applySeparation(state.sepT);
  if (state.sepT === 0 || state.sepT === 1) state.sepDir = 0;
}

// ---------------------------------------------------------------------------
// Pointer: hover, click and tap
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pick(x, y) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(rocket.meshes, false);
  for (const hit of hits) if (isHoverable(hit.object)) return hit.object.userData.partId;
  return null;
}

function touch() {
  state.lastActivity = performance.now();
}

const activePointers = new Set();
let down = null;

canvas.addEventListener('pointermove', (e) => {
  state.pointer.x = e.clientX;
  state.pointer.y = e.clientY;
  state.pointer.inside = true;
  state.pointer.mouse = e.pointerType !== 'touch';
  state.pointer.dirty = true;
});
canvas.addEventListener('pointerleave', () => {
  state.pointer.inside = false;
  if (state.hovered) {
    state.hovered = null;
    touch();
    refresh();
  }
  canvas.style.cursor = '';
});
canvas.addEventListener('pointerdown', (e) => {
  activePointers.add(e.pointerId);
  state.pointer.mouse = e.pointerType !== 'touch';
  down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, multi: activePointers.size > 1 };
  if (down.multi) down = null;
});
const pointerDone = (e) => {
  activePointers.delete(e.pointerId);
  if (!down || down.id !== e.pointerId) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 700;
  down = null;
  if (e.type !== 'pointerup' || moved > 8 || !quick) return;
  onTap(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', pointerDone);
canvas.addEventListener('pointercancel', pointerDone);

function onTap(x, y) {
  scene.updateMatrixWorld();
  const id = pick(x, y);
  ui.hideHint();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  if (id) {
    state.pinned = id;
    state.pointer.x = x;
    state.pointer.y = y;
  } else {
    state.pinned = null;
  }
  touch();
  refresh(true);
}

function updateHover() {
  if (!state.pointer.inside || !state.pointer.mouse) return;
  scene.updateMatrixWorld();
  const id = state.dragging ? state.hovered : pick(state.pointer.x, state.pointer.y);
  canvas.style.cursor = id ? 'pointer' : state.dragging ? 'grabbing' : 'grab';
  if (id !== state.hovered) {
    state.hovered = id;
    if (id) ui.hideHint();
    touch();
    refresh();
  } else if (id && state.pointer.dirty && !state.pinned && !state.preview) {
    ui.moveCard({ rect: partRect(id), pointer: state.pointer });
  }
  state.pointer.dirty = false;
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function updateLights() {
  _dir.subVectors(camera.position, controls.target).normalize();
  _right.crossVectors(UP, _dir).normalize();
  const t = controls.target;
  lights.key.position.copy(t).addScaledVector(_dir, 12).addScaledVector(_right, 8).addScaledVector(UP, 9);
  lights.rimL.position.copy(t).addScaledVector(_dir, -12).addScaledVector(_right, -9).addScaledVector(UP, 5);
  lights.rimR.position.copy(t).addScaledVector(_dir, -12).addScaledVector(_right, 9).addScaledVector(UP, 3);
  for (const l of [lights.key, lights.rimL, lights.rimR]) l.target.position.copy(t);
}

function updateAutoRotate(now) {
  const busy = state.dragging || state.hovered || state.pinned || state.preview || tween;
  if (busy) state.lastActivity = now;
  controls.autoRotate = state.autoRotate && !busy && now - state.lastActivity > IDLE_RESUME_MS;
}

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = performance.now();
  updateSeparation(dt);
  updateTween(dt);
  updateViewShift(dt);
  updateAutoRotate(now);
  controls.update(dt);
  updateLights();
  updateHover();
  updateMeshes(dt);
  if (!reducedMotion) stars.material.uniforms.uTime.value += dt;
  if (layout.W && layout.H) composer.render(dt);
}

motionQuery.addEventListener('change', (e) => {
  reducedMotion = e.matches;
  if (reducedMotion) {
    state.autoRotate = false;
    ui.setAutoRotate(false);
  }
});

// Build the scene now that every helper above is defined.
try {
  scene.background = paintBackground(innerWidth, innerHeight);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;
  pmrem.dispose();
  ui.setProgress(0.5);

  stars = makeStars(3000);
  scene.add(stars);

  lights.hemi = new THREE.HemisphereLight('#a8c2ff', '#0b1026', 0.3);
  lights.key = new THREE.DirectionalLight('#ffe2c2', 1.75);
  lights.rimL = new THREE.DirectionalLight('#6aa8ff', 3.2);
  lights.rimR = new THREE.DirectionalLight('#6aa8ff', 2.2);
  scene.add(lights.hemi, lights.key, lights.rimL, lights.rimR);
  scene.add(lights.key.target, lights.rimL.target, lights.rimR.target);

  const systemColors = Object.fromEntries(Object.entries(SYSTEMS).map(([k, v]) => [k, v.color]));
  rocket = buildRocket({ anisotropy: renderer.capabilities.getMaxAnisotropy(), systemColors });
  rocket.root.position.y = -ROCKET_HEIGHT / 2;
  scene.add(rocket.root);
  for (const m of rocket.meshes) {
    m.renderOrder = m.userData.layer === 'skin' ? 2 : 1;
    m.userData.opacity = targetOpacity(m);
    m.userData.hl = 0;
    m.userData.dim = 0;
    m.userData.glow = 0;
    m.userData.hlColor = new THREE.Color();
  }
  ui.setProgress(0.75);

  controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.8;
  controls.minPolarAngle = 0.32;
  controls.maxPolarAngle = Math.PI * 0.68;
  controls.autoRotateSpeed = ROTATE_SPEED;
  controls.addEventListener('start', () => {
    state.dragging = true;
    touch();
  });
  controls.addEventListener('end', () => {
    state.dragging = false;
    touch();
  });

  composer = makeComposer();
  updateLayout();
  computeFits();
  placeCamera(fits.assembled.center, fits.assembled.distance, HOME.azimuth, HOME.polar);
  controls.minDistance = fits.assembled.distance * 0.3;
  controls.maxDistance = Math.max(fits.assembled.distance, fits.separated.distance) * 1.7;
  controls.update();
  ui.setProgress(0.85);
} catch (err) {
  ui.showError();
  throw err;
}

// First frame, then hide the loading screen.
try {
  rocket.meshes.forEach((m) => (m.visible = true));
  // Compile shaders before the first frame (in parallel where supported).
  if (renderer.extensions.has('KHR_parallel_shader_compile')) {
    await renderer.compileAsync(scene, camera).catch(() => {});
  } else {
    renderer.compile(scene, camera);
  }
  updateMeshes(0);
  frame();
  ui.setProgress(0.95);
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
  updateLayout();
  onResize();
  renderer.setAnimationLoop(frame);
  ui.finishLoading(reducedMotion);
} catch (err) {
  ui.showError();
  throw err;
}

// Test hooks, only with ?debug in the address.
if (new URLSearchParams(location.search).has('debug')) {
  window.__rocket = {
    state,
    THREE,
    camera,
    controls,
    rocket,
    fits,
    setAngle(azimuthDeg, polarDeg, zoom = 1) {
      const fit = currentFit();
      tween = null;
      state.autoRotate = false;
      placeCamera(fit.center, fit.distance * zoom, azimuthDeg * DEG, polarDeg * DEG);
      controls.update();
    },
    // Close-up: rocket height y (0 at the nozzle exit, 12.3 at the tip).
    look(y, distance, azimuthDeg, polarDeg) {
      tween = null;
      state.autoRotate = false;
      controls.minDistance = Math.min(controls.minDistance, distance);
      placeCamera(new THREE.Vector3(0, y - ROCKET_HEIGHT / 2, 0), distance, azimuthDeg * DEG, polarDeg * DEG);
      controls.update();
    },
    // Advance the scene by `seconds` without relying on animation frames
    // (a hidden test browser pauses them).
    tick(seconds = 0.5, steps = 30) {
      const dt = seconds / steps;
      for (let i = 0; i < steps; i++) {
        updateSeparation(dt);
        updateTween(dt);
        updateViewShift(dt);
        controls.update(dt);
        updateLights();
        updateHover();
        updateMeshes(dt);
      }
      composer.render(dt);
    },
    setView,
    setSeparation(t) {
      state.sepT = t;
      state.sepDir = 0;
      state.separated = t > 0.5;
      ui.setSeparated(state.separated);
      applySeparation(t);
    },
    hoverPart(id) {
      state.hovered = id;
      refresh(true);
    },
    pinPart(id) {
      ensureVisible(id);
      state.pinned = id;
      refresh(true);
    },
    pick,
    partRect,
    hoverable: () => [...new Set(rocket.meshes.filter(isHoverable).map((m) => m.userData.partId))],
  };
}
