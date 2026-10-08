// Builds the rocket from Three.js geometry. No external models.
//
// Every mesh carries:
//   userData.partId  which part it belongs to (see parts.js)
//   userData.layer   how it behaves in the two views:
//                      'skin'  outer shell: solid outside, faint glass inside
//                      'solid' solid in both views (fins, nozzle, rings, antennas)
//                      'inner' hidden outside, shown inside
//   userData.reveal  for inner meshes that stage separation exposes in the
//                    outside view: 'b' (upper-stage engine) or 'c' (payload)
//
// Units are arbitrary; y is up and the base of the main nozzle sits at y = 0.

import * as THREE from 'three';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const R = 0.5; // core radius
const FAIRING_R = 0.55;
const OGIVE_BASE = 11.0;
const TIP = 12.3;
const OGIVE_L = TIP - OGIVE_BASE;
const RHO = (FAIRING_R ** 2 + OGIVE_L ** 2) / (2 * FAIRING_R); // tangent ogive radius

const BOOSTER_X = 0.9;
const BOOSTER_R = 0.28;

export const ROCKET_HEIGHT = TIP;

const COLOR = {
  skin: '#eef1f6',
  dark: '#1c2130',
  ring: '#f6f8ff',
  metal: '#9aa3b5',
  copper: '#4f3627',
  glow: '#ff7a2a',
  fuel: '#2f6fff',
  oxidiser: '#36d6e7',
};

// Outer radius of the fairing and nose profile at height y.
function noseRadius(y) {
  if (y <= 9.8) return R;
  if (y < 10.05) return R + (FAIRING_R - R) * Math.sin(((y - 9.8) / 0.25) * (Math.PI / 2));
  if (y <= OGIVE_BASE) return FAIRING_R;
  const x = TIP - y; // distance from the tip
  return Math.max(0, Math.sqrt(RHO * RHO - (OGIVE_L - x) ** 2) + FAIRING_R - RHO);
}

function profile(y0, y1, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    pts.push([noseRadius(y), y]);
  }
  return pts;
}

// Points are [radius, height] pairs listed bottom to top, which gives
// outward-facing normals.
function lathe(points, segments = 64, phiStart = 0, phiLength = TAU) {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
    phiStart,
    phiLength,
  );
}

// Re-map lathe UVs so the panel texture repeats at a fixed size in world
// units: `panels` vertical seams around a full turn, a horizontal seam every
// `pitch` units of height (lined up with the ring frames).
function panelUVs(geo, panels = 8, phiLength = TAU, pitch = 0.6) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const turns = phiLength / TAU;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * panels * turns, pos.getY(i) / pitch);
  }
  uv.needsUpdate = true;
  return geo;
}

// Capsule tank with elliptical domes.
function tankGeometry(y0, y1, radius, dome) {
  const pts = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push([radius * Math.sin(a), y0 + dome - dome * Math.cos(a)]);
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push([radius * Math.cos(a), y1 - dome + dome * Math.sin(a)]);
  }
  return lathe(pts, 48);
}

// Bell nozzle from the exit (bottom) up to the throat.
function bellPoints(yExit, yThroat, rExit, rThroat, steps = 16) {
  const pts = [];
  const h = yThroat - yExit;
  for (let i = 0; i <= steps; i++) {
    const y = yExit + (h * i) / steps;
    const d = (yThroat - y) / h; // 1 at the exit, 0 at the throat
    pts.push([rThroat + (rExit - rThroat) * Math.pow(d, 0.62), y]);
  }
  return pts;
}

function panelTexture(anisotropy) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(112, 124, 148, 0.30)';
  g.fillRect(0, 0, size, 3); // horizontal seam
  g.fillRect(0, 0, 3, size); // vertical seam
  g.fillStyle = 'rgba(112, 124, 148, 0.10)';
  g.fillRect(0, size / 2, size, 1); // very faint mid-panel line
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

function std(params) {
  return new THREE.MeshStandardMaterial(params);
}

// A group that rotates around `pivot` while its children keep rocket coordinates.
function pivotGroup(x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const inner = new THREE.Group();
  inner.position.set(-x, -y, -z);
  pivot.add(inner);
  pivot.userData.home = pivot.position.clone();
  return { pivot, inner };
}

// Direction in the horizontal plane: 0 deg = +x, 90 deg = +z.
function radial(deg, r, y) {
  return new THREE.Vector3(r * Math.cos(deg * DEG), y, r * Math.sin(deg * DEG));
}

export function buildRocket({ anisotropy = 4, systemColors }) {
  const root = new THREE.Group();
  root.name = 'rocket';
  const meshes = [];
  const byPart = new Map();
  const panels = panelTexture(anisotropy);

  // Assemblies that move during stage separation.
  const core = new THREE.Group(); // second stage, avionics, payload, upper-stage engine
  const first = new THREE.Group(); // first stage, main engine, fins, interstage
  const boosters = [pivotGroup(BOOSTER_X, 0.95, 0), pivotGroup(-BOOSTER_X, 0.95, 0)];
  const halves = [pivotGroup(R, 9.8, 0), pivotGroup(-R, 9.8, 0)]; // fairing + nose, x > 0 and x < 0
  root.add(core, first, ...boosters.map((b) => b.pivot), ...halves.map((h) => h.pivot));

  const sys = (id) => systemColors[id];

  function add(parent, geometry, material, partId, layer, extra = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { partId, layer, reveal: null, ...extra };
    mesh.userData.base = {
      color: material.color.clone(),
      emissive: material.emissive.clone(),
      emissiveIntensity: material.emissiveIntensity,
    };
    parent.add(mesh);
    meshes.push(mesh);
    if (!byPart.has(partId)) byPart.set(partId, []);
    byPart.get(partId).push(mesh);
    return mesh;
  }

  // Material factories: one material per mesh so each can be dimmed and lit
  // on its own.
  const skin = (extra = {}) =>
    std({ color: COLOR.skin, roughness: 0.45, metalness: 0.1, map: panels, ...extra });
  const plain = (color, extra = {}) => std({ color, roughness: 0.45, metalness: 0.1, ...extra });
  const dark = (extra = {}) => std({ color: COLOR.dark, roughness: 0.55, metalness: 0.35, ...extra });
  const ring = () =>
    std({
      color: COLOR.ring,
      roughness: 0.22,
      metalness: 0.55,
      emissive: '#a9c2ff',
      emissiveIntensity: 0.32,
    });
  const metal = (color = COLOR.metal) => std({ color, roughness: 0.35, metalness: 0.6 });
  const inner = (color, extra = {}) =>
    std({
      color,
      emissive: color,
      emissiveIntensity: 0.16,
      roughness: 0.5,
      metalness: 0.15,
      ...extra,
    });
  // Emissive starts at zero; it only shows when the upper-stage engine glows.
  const copperOut = () =>
    std({
      color: COLOR.copper,
      roughness: 0.42,
      metalness: 0.85,
      envMapIntensity: 0.6,
      emissive: COLOR.glow,
      emissiveIntensity: 0,
    });
  const copperIn = () =>
    std({
      color: '#2a1a12',
      roughness: 0.6,
      metalness: 0.3,
      emissive: COLOR.glow,
      emissiveIntensity: 0.45,
      side: THREE.BackSide,
    });

  function nozzle(parent, partId, layer, pts, rimR, rimY, extra = {}) {
    const geo = lathe(pts, 48);
    add(parent, geo, copperOut(), partId, layer, extra);
    add(parent, geo, copperIn(), partId, layer, extra);
    const rim = new THREE.TorusGeometry(rimR, 0.009, 6, 48);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, rimY, 0);
    add(parent, rim, copperOut(), partId, layer, extra);
  }

  // ---------------------------------------------------------------------
  // First stage assembly (drops away in step b)
  // ---------------------------------------------------------------------

  // Outer skin 0.8 to 6.5, including the slightly flared engine-bay skirt.
  add(
    first,
    panelUVs(lathe([[0.545, 0.8], [0.53, 0.95], [0.505, 1.12], [R, 1.25], [R, 6.5]], 64)),
    skin(),
    'first-stage',
    'skin',
  );
  // Heat shield closing the engine bay from below (hole for the nozzle).
  {
    const g = new THREE.RingGeometry(0.2, 0.545, 48, 1);
    g.rotateX(Math.PI / 2); // face down
    g.translate(0, 0.8, 0);
    add(first, g, plain('#3a4152', { roughness: 0.7, metalness: 0.2 }), 'first-stage', 'skin');
  }
  // Forward bulkhead at the top of the first stage (seen after separation).
  {
    const g = new THREE.CircleGeometry(R, 48);
    g.rotateX(-Math.PI / 2); // face up
    g.translate(0, 6.5, 0);
    add(first, g, plain('#c3cad8'), 'first-stage', 'skin');
  }

  // Interstage: dark band 6.5 to 7.5. Double-sided so its inside shows
  // once it drops away.
  add(first, lathe([[R, 6.5], [R, 7.5]], 64), dark({ side: THREE.DoubleSide }), 'interstage', 'skin');

  // Four fins at 45, 135, 225 and 315 degrees.
  {
    const s = new THREE.Shape();
    s.moveTo(0, 0.86);
    s.lineTo(0, 1.95);
    s.lineTo(0.44, 1.1);
    s.lineTo(0.44, 0.74);
    s.lineTo(0, 0.86);
    const depth = 0.032;
    const g = new THREE.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 2,
      curveSegments: 1,
    });
    g.translate(0.47, 0, -depth / 2);
    for (const deg of [45, 135, 225, 315]) {
      const m = add(first, g, plain('#e3e8f1', { roughness: 0.5 }), 'fins', 'solid');
      m.rotation.y = -deg * DEG;
    }
  }

  // Main nozzle: bell from exit (radius 0.38 at y = 0) up to the throat.
  nozzle(first, 'nozzle', 'solid', bellPoints(0, 0.88, 0.38, 0.11), 0.38, 0, {});

  // Combustion chamber above the throat.
  add(
    first,
    lathe(
      [[0.11, 0.86], [0.14, 0.92], [0.155, 1.0], [0.155, 1.24], [0.12, 1.3], [0.06, 1.34], [0.0, 1.35]],
      40,
    ),
    inner(sys('propulsion')),
    'combustion-chamber',
    'inner',
  );

  // Gimbal joint at the top of the engine, with two actuators.
  {
    const c = sys('guidance');
    add(first, new THREE.SphereGeometry(0.06, 24, 16).translate(0, 1.41, 0), inner(c), 'gimbal', 'inner');
    const yoke = new THREE.TorusGeometry(0.085, 0.014, 8, 32);
    yoke.translate(0, 1.41, 0);
    add(first, yoke, inner(c), 'gimbal', 'inner');
    const yoke2 = new THREE.TorusGeometry(0.085, 0.014, 8, 32);
    yoke2.rotateY(Math.PI / 2);
    yoke2.translate(0, 1.41, 0);
    add(first, yoke2, inner(c), 'gimbal', 'inner');
    add(first, new THREE.CylinderGeometry(0.028, 0.028, 0.34, 12).translate(0, 1.63, 0), inner(c), 'gimbal', 'inner');
    for (const deg of [90, 180]) {
      const top = radial(deg, 0.2, 1.78);
      const bottom = radial(deg, 0.15, 1.16);
      const len = top.distanceTo(bottom);
      const g = new THREE.CylinderGeometry(0.018, 0.022, len, 10);
      const m = add(first, g, inner(c), 'gimbal', 'inner');
      m.position.copy(top).add(bottom).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bottom).normalize());
    }
  }

  // Turbopump beside the chamber.
  {
    const c = sys('propulsion');
    add(first, new THREE.CylinderGeometry(0.07, 0.07, 0.24, 20).translate(0.3, 1.26, 0), inner(c), 'turbopump', 'inner');
    add(first, new THREE.CylinderGeometry(0.095, 0.095, 0.07, 24).translate(0.3, 1.42, 0), inner(c), 'turbopump', 'inner');
    const housing = new THREE.TorusGeometry(0.075, 0.02, 8, 24);
    housing.rotateX(Math.PI / 2);
    housing.translate(0.3, 1.13, 0);
    add(first, housing, inner(c), 'turbopump', 'inner');
  }

  // First-stage tanks: oxidiser below, fuel above.
  add(first, tankGeometry(2.0, 4.4, 0.43, 0.22), inner(COLOR.oxidiser), 'oxidiser-tank', 'inner');
  add(first, tankGeometry(4.6, 6.4, 0.43, 0.22), inner(COLOR.fuel), 'fuel-tank', 'inner');

  // Feed lines.
  {
    const c = sys('propulsion');
    const tube = (pts, radius = 0.028) =>
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal'),
        64,
        radius,
        10,
        false,
      );
    // Fuel: from the bottom of the fuel tank straight down through the
    // oxidiser tank, then across to the turbopump.
    add(
      first,
      tube([[0, 4.66, 0], [0, 3.4, 0], [0, 2.1, 0], [0.05, 1.97, 0], [0.2, 1.9, 0], [0.29, 1.74, 0], [0.3, 1.47, 0]]),
      inner(c),
      'feed-lines',
      'inner',
    );
    // Oxidiser: a shorter line from the bottom of the oxidiser tank.
    add(
      first,
      tube([[0, 2.04, -0.2], [0, 1.88, -0.22], [0.12, 1.68, -0.2], [0.26, 1.54, -0.1], [0.3, 1.46, -0.03]]),
      inner(c),
      'feed-lines',
      'inner',
    );
    // Turbopump to combustion chamber.
    add(first, tube([[0.24, 1.22, 0], [0.2, 1.2, 0], [0.15, 1.18, 0]], 0.024), inner(c), 'feed-lines', 'inner');
  }

  // ---------------------------------------------------------------------
  // Core assembly (stays put): second stage, avionics, payload
  // ---------------------------------------------------------------------

  add(core, panelUVs(lathe([[R, 7.5], [R, 9.5]], 64)), skin(), 'second-stage', 'skin');
  {
    const g = new THREE.CircleGeometry(R, 48);
    g.rotateX(Math.PI / 2); // face down: the aft bulkhead seen after separation
    g.translate(0, 7.5, 0);
    add(core, g, plain('#c3cad8'), 'second-stage', 'skin');
  }

  // Separation rings: thin bright seams at 7.5 and 9.8.
  for (const y of [7.5, 9.8]) {
    add(
      core,
      new THREE.CylinderGeometry(0.513, 0.513, 0.04, 64, 1, true).translate(0, y, 0),
      ring(),
      'separation-system',
      'solid',
    );
  }

  // Second-stage tanks.
  add(core, tankGeometry(7.58, 8.46, 0.43, 0.16), inner(COLOR.oxidiser), 'oxidiser-tank', 'inner');
  add(core, tankGeometry(8.54, 9.42, 0.43, 0.16), inner(COLOR.fuel), 'fuel-tank', 'inner');

  // Upper-stage engine inside the interstage: small chamber and nozzle.
  {
    const extra = { reveal: 'b' };
    nozzle(core, 'upper-stage-engine', 'inner', bellPoints(6.66, 7.16, 0.25, 0.065, 14), 0.25, 6.66, extra);
    add(
      core,
      lathe([[0.065, 7.15], [0.09, 7.21], [0.095, 7.26], [0.095, 7.4], [0.07, 7.46], [0.0, 7.49]], 32),
      inner(sys('propulsion')),
      'upper-stage-engine',
      'inner',
      extra,
    );
  }

  // Avionics ring 9.5 to 9.8: outer band and the deck the payload sits on.
  add(core, lathe([[0.506, 9.5], [0.506, 9.8]], 64), metal('#b4bccb'), 'guidance', 'skin');
  {
    const g = new THREE.CircleGeometry(R, 48);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 9.8, 0);
    add(core, g, plain('#c3cad8'), 'guidance', 'skin');
  }
  // Inside the ring: guidance computers and a gyro unit.
  {
    const c = sys('guidance');
    for (const deg of [30, 150, 270]) {
      const m = add(core, new THREE.BoxGeometry(0.1, 0.11, 0.15), inner(c), 'guidance', 'inner');
      m.position.copy(radial(deg, 0.3, 9.62));
      m.rotation.y = -deg * DEG;
    }
    add(core, new THREE.SphereGeometry(0.055, 20, 14).translate(0, 9.64, 0), inner(c), 'guidance', 'inner');
    for (const rot of [0, Math.PI / 2]) {
      const g = new THREE.TorusGeometry(0.085, 0.01, 6, 32);
      g.rotateY(rot);
      g.translate(0, 9.64, 0);
      add(core, g, inner(c), 'guidance', 'inner');
    }
  }
  // Battery packs (three cells each) and two antennas outside the ring.
  {
    const c = sys('guidance');
    for (const deg of [90, 210]) {
      const centre = radial(deg, 0.3, 9.6);
      for (const k of [-1, 0, 1]) {
        const off = radial(deg + 90, 0.06 * k, 0);
        const g = new THREE.CylinderGeometry(0.028, 0.028, 0.13, 14);
        const m = add(core, g, inner(c), 'electrical-comms', 'inner');
        m.position.copy(centre).add(off);
      }
    }
    const s = new THREE.Shape();
    s.moveTo(0, -0.085);
    s.lineTo(0, 0.085);
    s.lineTo(0.12, 0.04);
    s.lineTo(0.12, -0.02);
    s.lineTo(0, -0.085);
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.018,
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.004,
      bevelSegments: 1,
    });
    g.translate(0.5, 9.65, -0.009);
    for (const deg of [60, 240]) {
      const m = add(core, g, metal('#4a5368'), 'electrical-comms', 'solid');
      m.rotation.y = -deg * DEG;
    }
  }

  // Payload: satellite on a conical adapter.
  {
    const c = sys('payload');
    const extra = { reveal: 'c' };
    add(core, lathe([[0.36, 9.8], [0.36, 9.83], [0.2, 10.02], [0.2, 10.04]], 40), inner(c), 'payload', 'inner', extra);
    add(core, new THREE.BoxGeometry(0.38, 0.4, 0.38).translate(0, 10.24, 0), inner(c, { metalness: 0.4, roughness: 0.35 }), 'payload', 'inner', extra);
    // Folded solar panels against two sides.
    for (const sx of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.024, 0.36, 0.34).translate(sx * 0.205, 10.24, 0);
      add(core, g, inner('#c98f2a', { emissive: c, metalness: 0.3, roughness: 0.4 }), 'payload', 'inner', extra);
    }
    // Small dish on top.
    add(core, new THREE.CylinderGeometry(0.018, 0.018, 0.08, 10).translate(0, 10.48, 0), inner(c), 'payload', 'inner', extra);
    const dishPts = [];
    for (let i = 0; i <= 8; i++) {
      const r = (0.13 * i) / 8;
      dishPts.push([r, 10.52 + 3 * r * r]);
    }
    add(core, lathe(dishPts, 32), inner(c, { side: THREE.DoubleSide }), 'payload', 'inner', extra);
  }

  // ---------------------------------------------------------------------
  // Fairing halves and nose (swing open in step c)
  // ---------------------------------------------------------------------

  const fairingPts = [...profile(9.8, 10.05, 6), ...profile(10.05, OGIVE_BASE, 1).slice(1), ...profile(OGIVE_BASE, 11.6, 10).slice(1)];
  const nosePts = profile(11.6, TIP, 14);
  halves.forEach(({ inner: group }, i) => {
    const phiStart = i === 0 ? 0 : Math.PI; // half 0 covers x >= 0
    add(
      group,
      panelUVs(lathe(fairingPts, 40, phiStart, Math.PI), 8, Math.PI),
      skin({ side: THREE.DoubleSide }),
      'payload-fairing',
      'skin',
    );
    add(
      group,
      lathe(nosePts, 40, phiStart, Math.PI),
      plain('#dfe5ef', { roughness: 0.32, metalness: 0.28, side: THREE.DoubleSide }),
      'nose-cone',
      'skin',
    );
    // Fairing seam along the edge of this half (+z for half 0, -z for half 1).
    const sz = i === 0 ? 1 : -1;
    const seamPts = [];
    for (let k = 0; k <= 30; k++) {
      const y = 9.82 + ((TIP - 0.06 - 9.82) * k) / 30;
      seamPts.push(new THREE.Vector3(0, y, sz * (noseRadius(y) + 0.006)));
    }
    add(
      group,
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seamPts), 60, 0.012, 6, false),
      ring(),
      'separation-system',
      'solid',
    );
  });

  // ---------------------------------------------------------------------
  // Side boosters at 0 and 180 degrees
  // ---------------------------------------------------------------------

  boosters.forEach(({ inner: group }, i) => {
    const sx = i === 0 ? 1 : -1;
    const b = new THREE.Group();
    b.position.x = sx * BOOSTER_X;
    group.add(b);
    add(
      b,
      panelUVs(lathe([[0.3, 0.92], [0.29, 1.0], [BOOSTER_R, 1.15], [BOOSTER_R, 5.3]], 40), 6),
      skin(),
      'side-boosters',
      'skin',
    );
    {
      const g = new THREE.CircleGeometry(0.3, 32);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0.92, 0);
      add(b, g, dark(), 'side-boosters', 'skin');
    }
    // Conical nose cap.
    const cap = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      cap.push([BOOSTER_R * Math.sqrt(1 - t * t * 0.98) * (1 - t * 0.85), 5.3 + 0.5 * t]);
    }
    cap.push([0, 5.8]);
    add(b, lathe(cap, 40), dark(), 'side-boosters', 'skin');
    nozzle(b, 'side-boosters', 'solid', bellPoints(0.6, 0.93, 0.17, 0.08, 10), 0.17, 0.6, {});
    // Short struts to the core.
    for (const y of [1.5, 5.0]) {
      const g = new THREE.CylinderGeometry(0.034, 0.034, 0.16, 12);
      g.rotateZ(Math.PI / 2);
      g.translate(-sx * 0.345, y, 0);
      add(b, g, metal(), 'side-boosters', 'solid');
    }
  });

  // ---------------------------------------------------------------------
  // Airframe: ring frames every 0.6 units and 8 stringers, split per assembly
  // ---------------------------------------------------------------------
  {
    const c = sys('structure');
    const frameMat = () => inner(c, { emissiveIntensity: 0.1, roughness: 0.6 });
    for (let y = 1.2; y < 11.5; y += 0.6) {
      const yy = Math.round(y * 10) / 10;
      const r = (yy > 9.8 ? noseRadius(yy) : R) - 0.032;
      if (yy < 9.8) {
        const g = new THREE.TorusGeometry(r, 0.0085, 6, 64);
        g.rotateX(Math.PI / 2);
        g.translate(0, yy, 0);
        add(yy < 7.5 ? first : core, g, frameMat(), 'airframe', 'inner');
      } else {
        halves.forEach(({ inner: group }, i) => {
          const g = new THREE.TorusGeometry(r, 0.0085, 6, 32, Math.PI);
          g.rotateX(Math.PI / 2);
          g.rotateY(i === 0 ? Math.PI / 2 : -Math.PI / 2);
          g.translate(0, yy, 0);
          add(group, g, frameMat(), 'airframe', 'inner');
        });
      }
    }
    // Straight stringers in the first stage (with interstage) and the second stage.
    const stringer = (group, deg, y0, y1) => {
      const g = new THREE.BoxGeometry(0.022, y1 - y0, 0.012);
      const m = add(group, g, frameMat(), 'airframe', 'inner');
      m.position.copy(radial(deg, R - 0.03, (y0 + y1) / 2));
      m.rotation.y = -deg * DEG;
    };
    for (let k = 0; k < 8; k++) {
      const deg = 22.5 + 45 * k;
      stringer(first, deg, 0.86, 7.48);
      stringer(core, deg, 7.52, 9.78);
      // Curved stringers following the fairing profile, four in each half
      // (half 0 holds x >= 0).
      const pts = [];
      for (let j = 0; j <= 24; j++) {
        const y = 9.82 + ((11.5 - 9.82) * j) / 24;
        pts.push(radial(deg, noseRadius(y) - 0.03, y));
      }
      const group = Math.cos(deg * DEG) >= 0 ? halves[0].inner : halves[1].inner;
      add(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0075, 5, false), frameMat(), 'airframe', 'inner');
    }
    // Thrust beams carrying the gimbal, across the engine bay.
    for (const deg of [45, 135]) {
      const g = new THREE.BoxGeometry(0.9, 0.03, 0.03);
      const m = add(first, g, frameMat(), 'airframe', 'inner');
      m.position.set(0, 1.8, 0);
      m.rotation.y = -deg * DEG;
    }
  }

  // Soft light that comes on with the upper-stage engine during separation.
  const engineLight = new THREE.PointLight('#ff9a4a', 0, 3, 2);
  engineLight.position.set(0, 6.55, 0);
  core.add(engineLight);

  return {
    root,
    meshes,
    byPart,
    assemblies: { core, first, boosters, halves },
    engineLight,
  };
}
