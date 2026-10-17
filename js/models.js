// All 3D models, built from primitives so no asset files are needed.
import * as THREE from 'three';

/* ---------- shared material / geometry caches ---------- */

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = [color, opts.roughness, opts.metalness, opts.emissive, opts.emissiveIntensity].join('|');
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  }
  return matCache.get(key);
}

const bmatCache = new Map();
export function bmat(color) {
  if (!bmatCache.has(color)) bmatCache.set(color, new THREE.MeshBasicMaterial({ color }));
  return bmatCache.get(color);
}

const geoCache = new Map();
function geo(kind, ...args) {
  const key = kind + args.join(',');
  if (!geoCache.has(key)) {
    const ctors = {
      box: THREE.BoxGeometry, cyl: THREE.CylinderGeometry,
      sph: THREE.SphereGeometry, cone: THREE.ConeGeometry,
      torus: THREE.TorusGeometry, dodeca: THREE.DodecahedronGeometry,
    };
    geoCache.set(key, new ctors[kind](...args));
  }
  return geoCache.get(key);
}
export const boxGeo = (w, h, d) => geo('box', w, h, d);
export const cylGeo = (rt, rb, h, seg = 12) => geo('cyl', rt, rb, h, seg);
export const sphGeo = (r, seg = 10) => geo('sph', r, seg, seg);
export const coneGeo = (r, h, seg = 12) => geo('cone', r, h, seg);
export const torusGeo = (r, t, seg = 10) => geo('torus', r, t, seg, 16);

// Small parts don't cast shadows — only the major silhouette pieces do
// (set explicitly below), which keeps the shadow pass cheap.
function add(parent, geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const box = (p, w, h, d, c, x, y, z, o) => add(p, boxGeo(w, h, d), mat(c, o), x, y, z);
const cyl = (p, rt, rb, h, c, x, y, z, o) => add(p, cylGeo(rt, rb, h), mat(c, o), x, y, z);
const sph = (p, r, c, x, y, z, o) => add(p, sphGeo(r), mat(c, o), x, y, z);
const cone = (p, r, h, c, x, y, z, o) => add(p, coneGeo(r, h), mat(c, o), x, y, z);

export const ghostGreen = new THREE.MeshStandardMaterial({ color: 0x44ff44, transparent: true, opacity: 0.5, depthWrite: false });
export const ghostRed = new THREE.MeshStandardMaterial({ color: 0xff4444, transparent: true, opacity: 0.5, depthWrite: false });

/* ---------- world ---------- */

export function makeGroundTexture(style = 'grass') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d');
  c.fillStyle = style === 'desert' ? '#dfb96f' : '#67a84f';
  c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const g = 150 + Math.floor(Math.random() * 40);
    c.fillStyle = style === 'desert'
      ? `rgba(${g + 60},${g + 20},${g - 60},0.25)`
      : `rgba(${g - 80},${g},${g - 90},0.25)`;
    c.fillRect(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 20, 8 + Math.random() * 20);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

export function makeGround(size = 100) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture('grass'), roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

export function makeTree() {
  const g = new THREE.Group();
  cyl(g, 0.16, 0.24, 1.0, 0x6d4c33, 0, 0.5, 0).castShadow = true;
  cone(g, 0.95, 1.5, 0x2e7d32, 0, 1.7, 0).castShadow = true;
  cone(g, 0.7, 1.2, 0x388e3c, 0, 2.5, 0).castShadow = true;
  return g;
}

export function makeCactus() {
  const g = new THREE.Group();
  const green = 0x4c9a4c;
  cyl(g, 0.22, 0.26, 1.9, green, 0, 0.95, 0).castShadow = true;
  sph(g, 0.24, green, 0, 1.9, 0);
  // two arms
  cyl(g, 0.13, 0.13, 0.55, green, -0.42, 1.1, 0).rotation.z = Math.PI / 2;
  cyl(g, 0.13, 0.13, 0.5, green, -0.62, 1.35, 0).castShadow = true;
  cyl(g, 0.13, 0.13, 0.5, green, 0.4, 0.85, 0).rotation.z = Math.PI / 2;
  cyl(g, 0.13, 0.13, 0.45, green, 0.58, 1.08, 0).castShadow = true;
  return g;
}

export function makePyramid() {
  const m = new THREE.Mesh(geo('cone', 2.6, 2.2, 4), mat(0xcaa25c, { roughness: 1 }));
  m.position.y = 1.1;
  m.rotation.y = Math.PI / 4;
  m.castShadow = true;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

// Shared storm materials/geometry (storms are created and destroyed constantly).
const STORM_MAT = new THREE.MeshStandardMaterial({
  color: 0xa87f4a, transparent: true, opacity: 0.72, roughness: 1, depthWrite: false,
});
const STORM_DISC_MAT = new THREE.MeshBasicMaterial({ color: 0x6b4d2a, transparent: true, opacity: 0.45, depthWrite: false });
const STORM_DISC_GEO = new THREE.CircleGeometry(1.5, 24);

// A spinning sand whirlwind. scale 1 = the dust zombie's small storm.
export function makeSandstormMesh(scale = 1) {
  const g = new THREE.Group();
  const sandy = STORM_MAT;   // darker than the desert floor so storms stay visible on sand
  const disc = new THREE.Mesh(STORM_DISC_GEO, STORM_DISC_MAT);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;
  g.add(disc);
  const tiers = [
    [0.35, 0.3], [0.6, 0.9], [0.85, 1.5], [1.05, 2.1],
  ];
  for (const [r, y] of tiers) {
    const ring = new THREE.Mesh(cylGeo(r * 1.1, r * 0.75, 0.55, 10), sandy);
    ring.position.y = y;
    ring.rotation.y = Math.random() * Math.PI;
    g.add(ring);
  }
  const topRing = new THREE.Mesh(torusGeo(1.0, 0.12), sandy);
  topRing.position.y = 2.5;
  topRing.rotation.x = Math.PI / 2;
  g.add(topRing);
  g.scale.setScalar(scale);
  return g;
}

// The desert boss: a SUPER big infected sand worm with sharp teeth.
export function makeWormBoss() {
  const g = new THREE.Group();
  const skin = 0xc98a6d;
  const infected = 0x7cb342;

  const head = new THREE.Group();
  const skull = sph(head, 1.6, skin, 0, 0, 0, { roughness: 0.9 });
  skull.scale.set(1.05, 1.05, 1.25);
  skull.castShadow = true;
  // gaping mouth
  const mouth = cyl(head, 1.0, 1.0, 0.4, 0x3a1f18, 0, 0, 1.85);
  mouth.rotation.x = Math.PI / 2;
  // ring of SHARP teeth around the mouth, points aimed at the mouth center
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const tooth = cone(head, 0.14, 0.55, 0xf5f0e6, Math.cos(a) * 0.95, Math.sin(a) * 0.95, 1.95);
    tooth.rotation.z = a + Math.PI / 2;
  }
  // angry infected eyes
  const eyeMat = mat(0xff1744, { emissive: 0xff1744, emissiveIntensity: 1 });
  add(head, sphGeo(0.22), eyeMat, -0.6, 0.75, 1.1);
  add(head, sphGeo(0.22), eyeMat, 0.6, 0.75, 1.1);
  // infection blotches
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    sph(head, 0.18 + Math.random() * 0.14, infected,
      Math.cos(a) * 1.35, Math.sin(a) * 1.1, -0.4 + Math.random() * 1.4);
  }
  head.position.y = 2.1;
  g.add(head);

  // trailing body segments
  const segments = [];
  for (let i = 0; i < 6; i++) {
    const r = 1.35 - i * 0.14;
    const seg = new THREE.Mesh(sphGeo(1, 12), mat(i % 2 ? skin : 0xb87a5e, { roughness: 0.9 }));
    seg.scale.setScalar(r);
    seg.castShadow = i < 3;
    seg.position.set(0, r * 0.8, -2.2 - i * 1.7);
    // infection spots on some segments
    if (i % 2 === 0) {
      const spot = new THREE.Mesh(sphGeo(0.3, 8), mat(infected));
      spot.position.set(0.5, 0.55, 0);
      seg.add(spot);
    }
    g.add(seg);
    segments.push(seg);
  }

  g.scale.setScalar(1.7);   // snooper big
  return { group: g, head, segments };
}

export function makeRock() {
  const m = new THREE.Mesh(geo('dodeca', 0.5, 0), mat(0x8d8d8d, { roughness: 1 }));
  m.scale.set(1 + Math.random() * 0.6, 0.55 + Math.random() * 0.3, 1 + Math.random() * 0.6);
  m.castShadow = true;
  return m;
}

export function makeBase() {
  const g = new THREE.Group();
  cyl(g, 4.2, 4.5, 0.3, 0x9e9e9e, 0, 0.15, 0).receiveShadow = true;
  box(g, 3, 2, 2.8, 0xd7b98c, 0, 1.3, 0).castShadow = true;
  const roof = cone(g, 2.5, 1.5, 0xb0402f, 0, 3.05, 0);
  roof.castShadow = true;
  roof.geometry = geo('cone', 2.5, 1.5, 4);
  roof.rotation.y = Math.PI / 4;
  box(g, 0.75, 1.15, 0.1, 0x6d4c33, 0, 0.9, 1.42);
  box(g, 0.6, 0.55, 0.1, 0xa8d8ef, -0.95, 1.6, 1.42);
  box(g, 0.6, 0.55, 0.1, 0xa8d8ef, 0.95, 1.6, 1.42);
  cyl(g, 0.05, 0.05, 3, 0x757575, 1.7, 1.8, -1.1);
  box(g, 0.8, 0.45, 0.03, 0x2faf2f, 2.12, 3.05, -1.1);
  return g;
}

/* ---------- humanoid pieces ---------- */

function humanoid({ skin = 0x7cb85c, shirt = 0x5d6d3a, pants = 0x3e4a2a, zombieArms = true }) {
  const body = new THREE.Group();
  const legL = box(body, 0.22, 0.55, 0.22, pants, -0.17, 0.275, 0);
  const legR = box(body, 0.22, 0.55, 0.22, pants, 0.17, 0.275, 0);
  // legs pivot at hip: shift geometry down inside a pivot group
  const hipL = new THREE.Group(); hipL.position.set(-0.17, 0.55, 0);
  const hipR = new THREE.Group(); hipR.position.set(0.17, 0.55, 0);
  legL.position.set(0, -0.275, 0); legR.position.set(0, -0.275, 0);
  body.remove(legL); body.remove(legR);
  hipL.add(legL); hipR.add(legR);
  body.add(hipL, hipR);

  // only torso + head cast shadows: the silhouette reads fine and it halves the
  // shadow-pass draw calls per character
  const torso = box(body, 0.62, 0.65, 0.34, shirt, 0, 0.875, 0);
  torso.castShadow = true;
  const head = box(body, 0.42, 0.42, 0.42, skin, 0, 1.41, 0);
  head.castShadow = true;

  const armL = new THREE.Group(); armL.position.set(-0.4, 1.1, 0);
  const armR = new THREE.Group(); armR.position.set(0.4, 1.1, 0);
  box(armL, 0.17, 0.55, 0.17, skin, 0, -0.27, 0);
  box(armR, 0.17, 0.55, 0.17, skin, 0, -0.27, 0);
  if (zombieArms) { armL.rotation.x = -Math.PI / 2; armR.rotation.x = -Math.PI / 2; }
  body.add(armL, armR);

  return { body, head, legL: hipL, legR: hipR, armL, armR };
}

function addEyes(body, headY = 1.41, color = 0xff2222) {
  const eyeMat = mat(color, { emissive: color, emissiveIntensity: 0.9 });
  add(body, boxGeo(0.07, 0.07, 0.04), eyeMat, -0.1, headY + 0.05, 0.21);
  add(body, boxGeo(0.07, 0.07, 0.04), eyeMat, 0.1, headY + 0.05, 0.21);
}

/* ---------- zombies ---------- */

export function makeZombieMesh(type) {
  const group = new THREE.Group();  // moved / rotated by AI
  let h;
  let barY = 2.05;

  switch (type) {
    case 'normal': {
      h = humanoid({});
      addEyes(h.body);
      break;
    }
    case 'buff': {
      h = humanoid({ skin: 0x5da03f, shirt: 0x5da03f, pants: 0x7a2020 });
      addEyes(h.body);
      h.body.scale.set(1.5, 1.25, 1.4);
      barY = 2.7;
      break;
    }
    case 'fast': {
      h = humanoid({ skin: 0x9ccc65, shirt: 0x827717 });
      addEyes(h.body);
      h.body.scale.set(0.85, 1, 0.9);
      h.body.rotation.x = 0.22;
      break;
    }
    case 'stone': {
      h = humanoid({ shirt: 0x4e5a4e });
      h.head.visible = false;
      box(h.body, 0.62, 0.56, 0.6, 0x8d8d8d, 0, 1.5, 0, { roughness: 1 }).castShadow = true;
      box(h.body, 0.66, 0.12, 0.2, 0x757575, 0, 1.6, 0.24);
      addEyes(h.body, 1.48, 0xffee58);
      barY = 2.25;
      break;
    }
    case 'fire': {
      h = humanoid({ skin: 0xff7733, shirt: 0xbf360c, pants: 0x870000 });
      const m = mat(0xff7733, { emissive: 0xff3300, emissiveIntensity: 0.5 });
      h.head.material = m;
      addEyes(h.body, 1.41, 0xffff00);
      break;
    }
    case 'soccer': {
      h = humanoid({ shirt: 0xffffff, pants: 0x212121 });
      addEyes(h.body);
      const ball = new THREE.Group();
      sph(ball, 0.2, 0xffffff, 0, 0, 0);
      add(ball, torusGeo(0.2, 0.035), mat(0x212121), 0, 0, 0).rotation.x = Math.PI / 2;
      ball.position.set(0.3, 0.2, 0.45);
      h.body.add(ball);
      break;
    }
    case 'sword': {
      h = humanoid({ shirt: 0x37474f });
      addEyes(h.body);
      box(h.armR, 0.2, 0.06, 0.2, 0xc9a227, 0, -0.56, 0);
      const blade = box(h.armR, 0.07, 0.8, 0.15, 0xcfd8dc, 0, -0.98, 0, { metalness: 0.7, roughness: 0.3 });
      blade.name = 'blade';
      break;
    }
    case 'axe': {
      h = humanoid({ shirt: 0x4e342e });
      addEyes(h.body);
      cyl(h.armR, 0.045, 0.045, 0.85, 0x6d4c33, 0, -0.75, 0);
      box(h.armR, 0.3, 0.24, 0.07, 0xb0bec5, 0.16, -1.05, 0, { metalness: 0.7, roughness: 0.3 });
      break;
    }
    case 'baseball': {
      h = humanoid({ shirt: 0xe0e0e0, pants: 0x9e9e9e });
      addEyes(h.body);
      box(h.body, 0.46, 0.14, 0.46, 0xd32f2f, 0, 1.68, 0);
      box(h.body, 0.42, 0.05, 0.22, 0xd32f2f, 0, 1.63, 0.3);
      cyl(h.armR, 0.07, 0.045, 0.72, 0xd7a86e, 0, -0.85, 0);
      break;
    }
    case 'hockey': {
      h = humanoid({ shirt: 0x1a237e, pants: 0x0d123d });
      box(h.body, 0.36, 0.32, 0.07, 0xf5f5f5, 0, 1.43, 0.23);
      addEyes(h.body, 1.46, 0x111111);
      // hockey stick in right hand
      cyl(h.armR, 0.04, 0.04, 1.0, 0xd7a86e, 0, -0.8, 0);
      box(h.armR, 0.08, 0.1, 0.35, 0xd7a86e, 0, -1.28, 0.12);
      barY = 2.25;
      break;
    }
    case 'acid': {
      h = humanoid({ skin: 0x7ee24a, shirt: 0x33691e, pants: 0x1b5e20 });
      addEyes(h.body, 1.41, 0xccff00);
      // dripping acid blobs
      const blobMat = mat(0x9cff57, { emissive: 0x66bb6a, emissiveIntensity: 0.5 });
      add(h.body, sphGeo(0.09), blobMat, -0.2, 1.2, 0.18);
      add(h.body, sphGeo(0.07), blobMat, 0.24, 0.95, 0.19);
      add(h.body, sphGeo(0.08), blobMat, 0.05, 0.62, 0.18);
      add(h.armR, sphGeo(0.1), blobMat, 0, -0.55, 0);
      break;
    }
    case 'dust': {
      h = humanoid({ skin: 0xd8b06a, shirt: 0xb8905a, pants: 0x8a6a42 });
      addEyes(h.body, 1.41, 0xffb300);
      // a little sandstorm swirls around it
      const swirl = makeSandstormMesh(0.3);
      swirl.position.y = 0.05;
      h.body.add(swirl);
      h.swirl = swirl;
      break;
    }
    case 'hacker': {
      h = humanoid({ skin: 0x9ccc65, shirt: 0x263238, pants: 0x1c262b });
      // hood
      box(h.body, 0.5, 0.5, 0.5, 0x263238, 0, 1.45, -0.05);
      add(h.body, boxGeo(0.34, 0.34, 0.05), mat(0x9ccc65), 0, 1.43, 0.21);
      addEyes(h.body, 1.43, 0x00ff66);
      // laptop held in zombie-arms
      const lap = new THREE.Group();
      box(lap, 0.52, 0.04, 0.36, 0x546e7a, 0, 0, 0);
      const screen = box(lap, 0.52, 0.36, 0.03, 0x546e7a, 0, 0.14, -0.2);
      screen.rotation.x = -0.35;
      const glow = add(screen, boxGeo(0.45, 0.29, 0.01), mat(0x00ff66, { emissive: 0x00ff66, emissiveIntensity: 0.8 }), 0, 0, 0.025);
      glow.castShadow = false;
      lap.position.set(0, 1.02, 0.55);
      h.body.add(lap);
      break;
    }
    default:
      h = humanoid({});
  }

  group.add(h.body);
  return { group, body: h.body, parts: h, barY };
}

/* ---------- turrets ---------- */

export function makeTurretMesh(def) {
  const group = new THREE.Group();
  const color = def.rarityColor;

  cyl(group, 0.5, 0.68, 0.5, 0x37474f, 0, 0.25, 0).castShadow = true;
  add(group, torusGeo(0.52, 0.06), mat(color, { emissive: color, emissiveIntensity: 0.35 }), 0, 0.52, 0).rotation.x = Math.PI / 2;
  cyl(group, 0.2, 0.24, 0.55, 0x546e7a, 0, 0.78, 0);

  const head = new THREE.Group();
  head.position.set(0, 1.2, 0);
  box(head, 0.55, 0.4, 0.7, color, 0, 0, 0).castShadow = true;
  const barrels = [];
  const barrelXs = def.name === 'Legendary Turret' ? [-0.15, 0.15] : [0];
  for (const bx of barrelXs) {
    const b = cyl(head, 0.075, 0.075, 0.55, 0x263238, bx, 0.02, 0.5);
    b.rotation.x = Math.PI / 2;
    barrels.push(b);
    const tip = add(head, torusGeo(0.09, 0.03), mat(color, { emissive: color, emissiveIntensity: 0.5 }), bx, 0.02, 0.78);
    tip.castShadow = false;
  }
  sph(head, 0.09, 0x263238, 0, 0.22, -0.28);
  if (def.acid) {
    // bubbling acid vat on the back of the head
    const vat = cyl(head, 0.14, 0.14, 0.22, 0x455a64, 0, 0.14, -0.22);
    vat.castShadow = false;
    add(head, sphGeo(0.12), mat(0x9cff57, { emissive: 0x7ee24a, emissiveIntensity: 0.7 }), 0, 0.3, -0.22);
  }
  group.add(head);

  // status FX (toggled by game logic)
  const stunFx = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const star = add(stunFx, sphGeo(0.09, 6), bmat(0xffe14f), Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
    star.castShadow = false;
  }
  stunFx.position.y = 1.95;
  stunFx.visible = false;
  group.add(stunFx);

  const hackFx = new THREE.Mesh(
    boxGeo(0.85, 0.65, 0.95),
    new THREE.MeshBasicMaterial({ color: 0x00ff66, wireframe: true })
  );
  hackFx.position.y = 1.2;
  hackFx.visible = false;
  group.add(hackFx);

  const hatSlot = new THREE.Group();
  hatSlot.position.set(0, 0.2, 0);
  head.add(hatSlot);

  return { group, head, hatSlot, stunFx, hackFx };
}

export function makeCostumeHat(style) {
  const g = new THREE.Group();
  switch (style) {
    case 'mustard': {
      cyl(g, 0.2, 0.2, 0.34, 0xffd21f, 0, 0.17, 0);
      cyl(g, 0.21, 0.21, 0.07, 0xffffff, 0, 0.12, 0);
      cone(g, 0.08, 0.18, 0xffd21f, 0, 0.43, 0);
      break;
    }
    case 'ketchup': {
      cyl(g, 0.2, 0.2, 0.34, 0xd32f2f, 0, 0.17, 0);
      cyl(g, 0.21, 0.21, 0.07, 0xffffff, 0, 0.12, 0);
      cone(g, 0.08, 0.18, 0xd32f2f, 0, 0.43, 0);
      break;
    }
    case 'wizard': {
      cyl(g, 0.36, 0.36, 0.05, 0x5e35b1, 0, 0.025, 0);
      cone(g, 0.24, 0.5, 0x5e35b1, 0, 0.3, 0);
      sph(g, 0.06, 0xffe14f, 0, 0.56, 0);
      break;
    }
    case 'crown': {
      cyl(g, 0.24, 0.26, 0.18, 0xffc107, 0, 0.09, 0, { metalness: 0.6, roughness: 0.3 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        cone(g, 0.06, 0.14, 0xffc107, Math.cos(a) * 0.19, 0.24, Math.sin(a) * 0.19, { metalness: 0.6, roughness: 0.3 });
      }
      sph(g, 0.06, 0xe53935, 0, 0.1, 0.25);
      break;
    }
    case 'cowboy': {
      cyl(g, 0.36, 0.38, 0.05, 0x8d6e63, 0, 0.025, 0);      // brim
      cyl(g, 0.2, 0.24, 0.22, 0x8d6e63, 0, 0.16, 0);        // crown
      cyl(g, 0.21, 0.21, 0.05, 0x4e342e, 0, 0.08, 0);       // band
      break;
    }
    case 'scientist': {
      // crazy white scientist hair + goggles
      sph(g, 0.2, 0xf5f5f5, -0.12, 0.1, -0.05);
      sph(g, 0.18, 0xf5f5f5, 0.14, 0.12, 0.02);
      sph(g, 0.16, 0xf5f5f5, 0, 0.16, -0.12);
      add(g, torusGeo(0.09, 0.03), mat(0x37474f), -0.11, 0.02, 0.2);
      add(g, torusGeo(0.09, 0.03), mat(0x37474f), 0.11, 0.02, 0.2);
      break;
    }
    case 'dragon': {
      const horn1 = cone(g, 0.08, 0.3, 0xbf360c, -0.18, 0.18, 0);
      horn1.rotation.z = 0.5;
      const horn2 = cone(g, 0.08, 0.3, 0xbf360c, 0.18, 0.18, 0);
      horn2.rotation.z = -0.5;
      for (let i = 0; i < 3; i++) cone(g, 0.05, 0.14, 0x2faf2f, 0, 0.1, -0.05 - i * 0.14);
      cone(g, 0.09, 0.22, 0xbf360c, 0, 0.08, 0.22).rotation.x = 1.2;
      break;
    }
  }
  return g;
}

/* ---------- player / people ---------- */

export function makePlayerMesh() {
  const group = new THREE.Group();
  const h = humanoid({ skin: 0xffcc99, shirt: 0x1e88e5, pants: 0x37474f, zombieArms: false });
  box(h.body, 0.46, 0.14, 0.46, 0x5d4037, 0, 1.68, 0);
  // friendly eyes
  const eyeMat = mat(0x263238);
  add(h.body, boxGeo(0.06, 0.06, 0.04), eyeMat, -0.09, 1.46, 0.21);
  add(h.body, boxGeo(0.06, 0.06, 0.04), eyeMat, 0.09, 1.46, 0.21);
  const weaponSlot = new THREE.Group();
  weaponSlot.position.set(0, -0.5, 0);
  h.armR.add(weaponSlot);
  group.add(h.body);
  return { group, body: h.body, parts: h, weaponSlot };
}

export function makeWeaponMesh(id) {
  const g = new THREE.Group();
  switch (id) {
    case 'bat':
      cyl(g, 0.065, 0.045, 0.7, 0xd7a86e, 0, -0.28, 0);
      break;
    case 'crowbar': {
      box(g, 0.05, 0.6, 0.05, 0x455a64, 0, -0.25, 0, { metalness: 0.6, roughness: 0.4 });
      box(g, 0.05, 0.05, 0.16, 0x455a64, 0, -0.55, 0.06, { metalness: 0.6, roughness: 0.4 });
      box(g, 0.05, 0.05, 0.12, 0xd32f2f, 0, 0.05, -0.05);
      break;
    }
    case 'gun': {
      box(g, 0.09, 0.14, 0.3, 0x263238, 0, -0.08, 0.12);
      const barrel = cyl(g, 0.035, 0.035, 0.26, 0x546e7a, 0, -0.04, 0.35);
      barrel.rotation.x = Math.PI / 2;
      sph(g, 0.045, 0x00e5ff, 0, -0.04, 0.5, { emissive: 0x00e5ff, emissiveIntensity: 0.8 });
      break;
    }
    case 'hammer': {
      cyl(g, 0.045, 0.045, 0.55, 0x8d6e63, 0, -0.25, 0);
      box(g, 0.32, 0.16, 0.16, 0x78909c, 0, -0.55, 0, { metalness: 0.6, roughness: 0.4 });
      box(g, 0.1, 0.17, 0.17, 0xffc107, 0.17, -0.55, 0, { metalness: 0.6, roughness: 0.4 });
      break;
    }
    case 'suit': {
      // giant robot power-fist
      box(g, 0.3, 0.34, 0.34, 0x90a4ae, 0, -0.45, 0, { metalness: 0.7, roughness: 0.3 });
      box(g, 0.32, 0.12, 0.36, 0x546e7a, 0, -0.62, 0.02, { metalness: 0.7, roughness: 0.3 });
      sph(g, 0.06, 0x00e5ff, 0, -0.45, 0.19, { emissive: 0x00e5ff, emissiveIntensity: 1 });
      break;
    }
  }
  return g;
}

export function makeRobotMesh() {
  const group = new THREE.Group();
  const silver = mat(0xb0bec5, { metalness: 0.6, roughness: 0.35 });
  const dark = mat(0x455a64, { metalness: 0.5, roughness: 0.5 });
  // treads
  add(group, boxGeo(0.55, 0.25, 0.7), dark, 0, 0.13, 0);
  // body
  const body = new THREE.Mesh(boxGeo(0.5, 0.55, 0.4), silver);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  add(group, boxGeo(0.34, 0.1, 0.28), mat(0xffc107), 0, 0.86, 0);
  // head with glowing eye strip
  const head = new THREE.Mesh(boxGeo(0.36, 0.3, 0.34), silver);
  head.position.y = 1.08;
  head.castShadow = true;
  group.add(head);
  const eye = add(group, boxGeo(0.26, 0.08, 0.03), mat(0x00e5ff, { emissive: 0x00e5ff, emissiveIntensity: 1 }), 0, 1.1, 0.18);
  eye.castShadow = false;
  // antenna
  cyl(group, 0.02, 0.02, 0.22, 0x78909c, 0, 1.33, 0);
  add(group, sphGeo(0.05), mat(0xff5252, { emissive: 0xff5252, emissiveIntensity: 0.9 }), 0, 1.46, 0).castShadow = false;
  // arms with a tool slot on the right
  const armL = new THREE.Group(); armL.position.set(-0.33, 0.75, 0);
  const armR = new THREE.Group(); armR.position.set(0.33, 0.75, 0);
  add(armL, boxGeo(0.12, 0.4, 0.12), dark, 0, -0.2, 0);
  add(armR, boxGeo(0.12, 0.4, 0.12), dark, 0, -0.2, 0);
  const toolSlot = new THREE.Group();
  toolSlot.position.set(0, -0.4, 0);
  armR.add(toolSlot);
  group.add(armL, armR);
  return { group, body, head, armL, armR, toolSlot };
}

// Bulky robot suit worn over the player (visible only while equipped).
export function makeSuitOverlay() {
  const g = new THREE.Group();
  const steel = mat(0x90a4ae, { metalness: 0.7, roughness: 0.3 });
  add(g, boxGeo(0.78, 0.75, 0.5), steel, 0, 0.88, 0).castShadow = true;      // chest plate
  add(g, boxGeo(0.3, 0.3, 0.3), steel, -0.55, 1.1, 0);                       // shoulder pads
  add(g, boxGeo(0.3, 0.3, 0.3), steel, 0.55, 1.1, 0);
  add(g, boxGeo(0.5, 0.34, 0.48), steel, 0, 1.45, 0);                        // helmet
  const visor = add(g, boxGeo(0.36, 0.1, 0.03), mat(0x00e5ff, { emissive: 0x00e5ff, emissiveIntensity: 1 }), 0, 1.45, 0.25);
  visor.castShadow = false;
  add(g, sphGeo(0.1), mat(0xffc107, { emissive: 0xff9800, emissiveIntensity: 0.8 }), 0, 0.88, 0.27).castShadow = false;  // arc reactor!
  return g;
}

export function makeBarbedWire(radius) {
  const g = new THREE.Group();
  const wireMat = mat(0x546e7a, { metalness: 0.6, roughness: 0.4 });
  const ring = new THREE.Mesh(torusGeo(radius, 0.05, 8), wireMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.45;
  g.add(ring);
  const ring2 = new THREE.Mesh(torusGeo(radius, 0.05, 8), wireMat);
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 0.85;
  g.add(ring2);
  const n = Math.round(radius * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const post = cyl(g, 0.04, 0.04, 1.0, 0x4e342e, Math.cos(a) * radius, 0.5, Math.sin(a) * radius);
    post.castShadow = false;
    // barb X
    const barb = new THREE.Mesh(boxGeo(0.16, 0.03, 0.03), wireMat);
    barb.position.set(Math.cos(a) * radius, 0.65, Math.sin(a) * radius);
    barb.rotation.set(0.7, a, 0.7);
    g.add(barb);
  }
  return g;
}

// Add-ons per base level (2-4); level 5 swaps the whole house for a castle.
export function makeBaseAddon(level) {
  const g = new THREE.Group();
  if (level === 3) {
    const stone = mat(0x78909c, { roughness: 1 });
    add(g, boxGeo(0.7, 1.4, 0.7), stone, -1.7, 0.95, 1.55).castShadow = true;
    add(g, boxGeo(0.7, 1.4, 0.7), stone, 1.7, 0.95, 1.55).castShadow = true;
    add(g, boxGeo(0.7, 1.4, 0.7), stone, -1.7, 0.95, -1.55);
    add(g, boxGeo(0.7, 1.4, 0.7), stone, 1.7, 0.95, -1.55);
    add(g, boxGeo(3.1, 0.5, 0.1), mat(0x90a4ae, { metalness: 0.5, roughness: 0.5 }), 0, 0.55, 1.46);
  }
  if (level === 4) {
    for (const [x, z] of [[-2.4, 2.2], [2.4, 2.2], [-2.4, -2.2], [2.4, -2.2]]) {
      const t = cyl(g, 0.45, 0.5, 2.6, 0x8d8d8d, x, 1.6, z);
      t.castShadow = true;
      cone(g, 0.55, 0.7, 0xb0402f, x, 3.25, z).castShadow = true;
      add(g, boxGeo(0.5, 0.3, 0.02), mat(0x2faf2f), x + 0.28, 3.5, z);
    }
  }
  return g;
}

export function makeCastle() {
  const g = new THREE.Group();
  const stone = mat(0x9e9e9e, { roughness: 1 });
  const darkStone = mat(0x757575, { roughness: 1 });
  cyl(g, 4.4, 4.7, 0.3, 0x8d8d8d, 0, 0.15, 0).receiveShadow = true;
  // keep
  const keep = add(g, boxGeo(3.2, 2.6, 3.2), stone, 0, 1.6, 0);
  keep.castShadow = true;
  // battlements on the keep
  for (let i = -1; i <= 1; i++) {
    add(g, boxGeo(0.5, 0.4, 0.5), darkStone, i * 1.2, 3.1, 1.35);
    add(g, boxGeo(0.5, 0.4, 0.5), darkStone, i * 1.2, 3.1, -1.35);
    add(g, boxGeo(0.5, 0.4, 0.5), darkStone, 1.35, 3.1, i * 1.2);
    add(g, boxGeo(0.5, 0.4, 0.5), darkStone, -1.35, 3.1, i * 1.2);
  }
  // corner towers
  for (const [x, z] of [[-2, 2], [2, 2], [-2, -2], [2, -2]]) {
    const t = cyl(g, 0.6, 0.7, 3.6, 0x9e9e9e, x, 2.1, z);
    t.castShadow = true;
    cone(g, 0.75, 0.9, 0x3f51b5, x, 4.35, z).castShadow = true;
    add(g, boxGeo(0.55, 0.35, 0.02), mat(0xffc107), x + 0.3, 4.7, z);
  }
  // gate
  add(g, boxGeo(1.0, 1.5, 0.12), mat(0x5d4037), 0, 1.05, 1.62);
  add(g, torusGeo(0.5, 0.1, 6), darkStone, 0, 1.8, 1.62).rotation.z = Math.PI;
  // big flag
  cyl(g, 0.05, 0.05, 2, 0x757575, 0, 3.9, 0);
  add(g, boxGeo(1.0, 0.55, 0.03), mat(0xffc107), 0.55, 4.6, 0);
  return g;
}

export function makeLootBuilding() {
  const g = new THREE.Group();
  const wall = mat(0x607d8b, { roughness: 0.9 });
  const b = add(g, boxGeo(3.2, 2.2, 2.6), wall, 0, 1.1, 0);
  b.castShadow = true;
  add(g, boxGeo(3.5, 0.2, 2.9), mat(0x455a64), 0, 2.3, 0);
  // boarded door
  add(g, boxGeo(0.9, 1.3, 0.08), mat(0x6d4c33), 0, 0.75, 1.34);
  add(g, boxGeo(1.0, 0.12, 0.1), mat(0x8d6e63), 0, 1.0, 1.36).rotation.z = 0.3;
  // money sign
  const sign = add(g, boxGeo(1.4, 0.6, 0.08), mat(0xffd21f, { emissive: 0xffc107, emissiveIntensity: 0.5 }), 0, 1.8, 1.36);
  sign.castShadow = false;
  sign.name = 'sign';
  // crates + coins outside
  add(g, boxGeo(0.6, 0.6, 0.6), mat(0x8d6e63), -1.5, 0.3, 1.6).castShadow = true;
  add(g, boxGeo(0.45, 0.45, 0.45), mat(0xa1887f), -1.1, 0.23, 2.1);
  add(g, sphGeo(0.12, 8), mat(0xffd21f, { metalness: 0.6, roughness: 0.3 }), 1.3, 0.12, 1.8).castShadow = false;
  add(g, sphGeo(0.1, 8), mat(0xffd21f, { metalness: 0.6, roughness: 0.3 }), 1.55, 0.1, 1.55).castShadow = false;
  return g;
}

const PERSON_SHIRTS = [0xe57373, 0x64b5f6, 0xffb74d, 0xba68c8, 0x4db6ac, 0xf06292];

export function makePersonMesh() {
  const group = new THREE.Group();
  const shirt = PERSON_SHIRTS[Math.floor(Math.random() * PERSON_SHIRTS.length)];
  const h = humanoid({ skin: 0xffcc99, shirt, pants: 0x455a64, zombieArms: false });
  box(h.body, 0.44, 0.1, 0.44, [0x5d4037, 0x263238, 0xf9a825, 0x8d6e63][Math.floor(Math.random() * 4)], 0, 1.67, 0);
  const eyeMat = mat(0x263238);
  add(h.body, boxGeo(0.06, 0.06, 0.04), eyeMat, -0.09, 1.46, 0.21);
  add(h.body, boxGeo(0.06, 0.06, 0.04), eyeMat, 0.09, 1.46, 0.21);
  group.add(h.body);
  return { group, parts: h };
}

export function makeCageMesh() {
  const g = new THREE.Group();
  cyl(g, 0.95, 1.05, 0.12, 0x4e4238, 0, 0.06, 0).castShadow = true;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    cyl(g, 0.045, 0.045, 1.9, 0x37474f, Math.cos(a) * 0.8, 1.02, Math.sin(a) * 0.8, { metalness: 0.5, roughness: 0.5 });
  }
  add(g, torusGeo(0.8, 0.05), mat(0x37474f, { metalness: 0.5, roughness: 0.5 }), 0, 1.95, 0).rotation.x = Math.PI / 2;
  add(g, torusGeo(0.8, 0.05), mat(0x37474f, { metalness: 0.5, roughness: 0.5 }), 0, 0.14, 0).rotation.x = Math.PI / 2;
  sph(g, 0.12, 0xffd21f, 0, 2.05, 0);
  return g;
}

/* ---------- traps & projectiles ---------- */

export function makeTrapMesh() {
  const g = new THREE.Group();
  box(g, 0.95, 0.08, 0.95, 0x4e4238, 0, 0.04, 0).castShadow = true;
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      cone(g, 0.07, 0.3, 0xb0bec5, ix * 0.28, 0.23, iz * 0.28, { metalness: 0.7, roughness: 0.3 });
    }
  }
  return g;
}

export function makeSoccerBallMesh() {
  const g = new THREE.Group();
  sph(g, 0.22, 0xffffff);
  add(g, torusGeo(0.22, 0.04), mat(0x212121), 0, 0, 0).rotation.x = Math.PI / 2;
  add(g, torusGeo(0.22, 0.04), mat(0x212121), 0, 0, 0);
  return g;
}

export function makeBaseballMesh() {
  const m = new THREE.Mesh(sphGeo(0.13, 8), mat(0xf5f5f5));
  m.castShadow = true;
  return m;
}

export function makeBulletMesh(color) {
  const m = new THREE.Mesh(sphGeo(0.11, 8), mat(color, { emissive: color, emissiveIntensity: 0.8 }));
  m.castShadow = false;
  return m;
}

/* ---------- world-space HP bars (sprites always face camera) ---------- */

// Shared sprite materials for every HP bar (no per-entity material allocations).
const HPBAR_BG = new THREE.SpriteMaterial({ color: 0x551111, depthTest: false, transparent: true, opacity: 0.85 });
const HPBAR_FG = {
  green: new THREE.SpriteMaterial({ color: 0x3ee63e, depthTest: false }),
  yellow: new THREE.SpriteMaterial({ color: 0xffc107, depthTest: false }),
  red: new THREE.SpriteMaterial({ color: 0xe53935, depthTest: false }),
};

export function makeHpBar(width = 1.2) {
  const group = new THREE.Group();
  const bg = new THREE.Sprite(HPBAR_BG);
  bg.scale.set(width, 0.13, 1);
  const fg = new THREE.Sprite(HPBAR_FG.green);
  fg.center.set(0, 0.5);
  fg.position.x = -width / 2;
  fg.position.z = 0.001;
  fg.scale.set(width, 0.1, 1);
  bg.renderOrder = 998;
  fg.renderOrder = 999;
  group.add(bg, fg);
  return {
    group,
    set(ratio) {
      const r = Math.max(0, Math.min(1, ratio));
      fg.scale.x = Math.max(0.0001, width * r);
      fg.material = r > 0.5 ? HPBAR_FG.green : r > 0.25 ? HPBAR_FG.yellow : HPBAR_FG.red;
      group.visible = r < 1;
    },
  };
}
