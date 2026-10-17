// Brady's Zombie Defense — main game logic.
import * as THREE from 'three';
import {
  FIELD_RADIUS, PLAY_BOUND, BASE_HP, PLAYER_HP, START_MONEY,
  BOSS, DESERT_START_WAVE, BOSS_EVERY,
  ZOMBIE_ORDER, ZOMBIES, ZOMBIE_UNLOCK_WAVE,
  TURRET_ORDER, TURRETS, COSTUMES, COSTUME_DAMAGE_BONUS, TURRET_AGGRO_RANGE,
  WEAPON_ORDER, WEAPONS, ITEM_ORDER, ITEMS,
  ROBOT, ALLY_CAP, ALLY_DAMAGE_MULT, ALLY_WEAPONS, BASE_LEVELS, LOOT_BUILDING,
  zombieHpScale, zombieDmgScale, waveComposition, waveReward,
} from './config.js';
import * as M from './models.js';
import { sfx, initAudio, toggleMute } from './audio.js';
import { TIERS, TIER_SETTINGS, isSoftwareRenderer, computePixelRatio, FrameGovernor, initialTier, rateLimit } from './quality.js';

/* ================= DOM ================= */

const $ = (id) => document.getElementById(id);
const hud = $('hud');
const banner = $('banner');
const floatLayer = $('float-layer');
const shopEl = $('shop');
const shopItems = $('shop-items');
const shopCur = $('shop-cur');

/* ================= three.js setup ================= */

// ---- graphics quality: probe the GPU first so we never start too heavy ----
// (Software WebGL — SwiftShader, llvmpipe, Remote Desktop's Basic Render Driver —
//  renders on the CPU and can pin the whole machine at full resolution.)
function probeRendererString() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return String(name || '');
  } catch { return ''; }
}
const gpuName = probeRendererString();
const softwareGpu = isSoftwareRenderer(gpuName);
const quality = initialTier({ saved: lsGet('bradyZombieQuality', null), softwareRenderer: softwareGpu, rendererString: gpuName });
const governor = new FrameGovernor({ tier: quality.tier, locked: quality.locked, now: performance.now() });

function createRenderer() {
  try {
    return new THREE.WebGLRenderer({
      antialias: !softwareGpu && !!gpuName && quality.tier === 'high',   // MSAA only on a known real GPU
      powerPreference: 'high-performance',                               // pick the discrete GPU on laptops
      preserveDrawingBuffer: false,
    });
  } catch (err) {
    // WebGL is blocked/unsupported: tell the player instead of leaving a dead PLAY button.
    const note = $('gfx-note');
    if (note) note.textContent = '⚠️ This browser cannot start 3D graphics (WebGL is off). Try another browser or turn on hardware acceleration.';
    const play = $('btn-play');
    if (play) { play.disabled = true; play.textContent = '3D graphics unavailable'; }
    throw err;   // nothing below can work without a renderer — stop, but explained
  }
}
const renderer = createRenderer();
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
// On software renderers, force the frame to actually finish so the governor measures
// the TRUE per-frame cost (otherwise the CPU rasterizer runs behind, invisible to us).
const glCtx = renderer.getContext();
const syncPixel = new Uint8Array(4);
function syncFrameIfSoftware() {
  if (!softwareGpu || !glCtx) return;
  try { glCtx.readPixels(0, 0, 1, 1, glCtx.RGBA, glCtx.UNSIGNED_BYTE, syncPixel); } catch { /* ignore */ }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 130);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 20, 20);

scene.add(new THREE.HemisphereLight(0xbfdfff, 0x3a5a2a, 0.9));
const sun = new THREE.DirectionalLight(0xfff4d6, 1.6);
sun.position.set(25, 40, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -50;
sun.shadow.camera.right = sun.shadow.camera.top = 50;
sun.shadow.camera.far = 120;
sun.shadow.bias = -0.0005;
scene.add(sun);

const ground = M.makeGround(110);
scene.add(ground);
let baseMesh = M.makeBase();
scene.add(baseMesh);

const trees = [];
for (let i = 0; i < 16; i++) {
  const tree = M.makeTree();
  const a = Math.random() * Math.PI * 2;
  const r = 33 + Math.random() * 10;
  tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  tree.rotation.y = Math.random() * Math.PI;
  scene.add(tree);
  trees.push(tree);
}
for (let i = 0; i < 9; i++) {
  const rock = M.makeRock();
  const a = Math.random() * Math.PI * 2;
  const r = 10 + Math.random() * 24;
  rock.position.set(Math.cos(a) * r, 0.2, Math.sin(a) * r);
  scene.add(rock);
}

// Apply a quality tier: internal resolution cap, shadows, particle budget, fps cap.
let particleCap = 250;
let fpsCap = 60;
let graceUntil = 0;   // governor ignores samples until this time (after tier changes / resume)
function applyQuality(tier) {
  const q = TIER_SETTINGS[tier] || TIER_SETTINGS.high;
  const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
  renderer.setPixelRatio(computePixelRatio(w, h, window.devicePixelRatio, q.maxPixels));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const wantShadows = q.shadowMap > 0;
  if (renderer.shadowMap.enabled !== wantShadows) {
    renderer.shadowMap.enabled = wantShadows;
    renderer.shadowMap.needsUpdate = true;
    // (no material traverse needed: flipping sun.castShadow changes the lights hash and
    //  three recompiles the lit programs itself)
  }
  sun.castShadow = wantShadows;
  // A tier change can trigger shader recompiles; don't let that stall read as a new panic.
  graceUntil = performance.now() + 1500;
  if (wantShadows && sun.shadow.mapSize.x !== q.shadowMap) {
    sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  particleCap = q.particles;
  fpsCap = q.fpsCap;

  const label = `🖥️ ${governor.locked ? '' : 'Auto · '}${tier[0].toUpperCase()}${tier.slice(1)}`;
  const btn = $('btn-gfx');
  if (btn) btn.textContent = label;
  const note = $('gfx-note');
  if (note) note.textContent = `${label}${softwareGpu ? ' (software graphics detected — running light)' : ''}`;
}
applyQuality(governor.tier);

window.addEventListener('resize', () => applyQuality(governor.tier));

/* ================= state ================= */

// Diamonds and costumes persist between games (kid-friendly progression).
function lsGet(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
}
function loadCostumes() {
  try { return JSON.parse(lsGet('bradyZombieCostumes', '{}')) || {}; } catch { return {}; }
}

const state = {
  running: false, over: false, shopOpen: false,
  time: 0,
  money: START_MONEY,
  diamonds: parseInt(lsGet('bradyZombieDiamonds', '0'), 10) || 0,
  emeralds: 0,
  wave: 0, phase: 'build', buildLeft: 20,
  spawnQueue: [], spawnTimer: 0,
  zombies: [], turrets: [], projectiles: [], traps: [], cages: [], people: [], particles: [],
  storms: [], boss: null, desert: false, shakeT: 0,
  baseLevel: 1, baseMax: BASE_HP, wireGroup: null,
  robot: null, allies: [], lootBuilding: null, freeTurretTier: null,
  baseHp: BASE_HP,
  costumes: loadCostumes(),           // rarity -> true when owned (persists between games)
  ownedWeapons: { fists: true },
  stats: { kills: 0, rescued: 0 },
  placing: null,
  shopTab: 'turrets',
};

const player = {
  hp: PLAYER_HP, max: PLAYER_HP,
  weapon: 'fists',
  mesh: null, parts: null, weaponSlot: null, weaponMeshes: {},
  attackCd: 0, swingT: 0, walkT: 0,
  dead: false, respawnAt: 0,
  facing: new THREE.Vector3(0, 0, 1),
};

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const irand = (n) => Math.floor(Math.random() * (n + 1));

/* ================= currencies & UI ================= */

function costText(cost) {
  if (!cost) return 'Free';
  if (cost.money != null) return `💵 ${cost.money}`;
  if (cost.diamonds != null) return `💎 ${cost.diamonds}`;
  if (cost.emeralds != null) return `<span class="em">♦</span> ${cost.emeralds}`;
  return '';
}
function canAfford(cost) {
  if (!cost) return true;
  if (cost.money != null) return state.money >= cost.money;
  if (cost.diamonds != null) return state.diamonds >= cost.diamonds;
  if (cost.emeralds != null) return state.emeralds >= cost.emeralds;
  return false;
}
function pay(cost) {
  if (!cost) return;
  if (cost.money != null) state.money -= cost.money;
  if (cost.diamonds != null) state.diamonds -= cost.diamonds;
  if (cost.emeralds != null) state.emeralds -= cost.emeralds;
  updateCurrencies();
}
function refund(cost) {
  if (!cost) return;
  if (cost.money != null) state.money += cost.money;
  if (cost.diamonds != null) state.diamonds += cost.diamonds;
  if (cost.emeralds != null) state.emeralds += cost.emeralds;
  updateCurrencies();
}

let lastSavedDiamonds = null;
function updateCurrencies() {
  if (lastSavedDiamonds !== state.diamonds) {   // don't hit localStorage on every kill
    lastSavedDiamonds = state.diamonds;
    lsSet('bradyZombieDiamonds', String(state.diamonds));
  }
  $('cur-money').textContent = state.money;
  $('cur-diamonds').textContent = state.diamonds;
  $('cur-emeralds').textContent = state.emeralds;
  shopCur.innerHTML = `<span>💵 ${state.money}</span><span>💎 ${state.diamonds}</span><span><span class="em">♦</span> ${state.emeralds}</span>`;
  if (state.shopOpen) renderShop();
}

function worldToScreen(pos) {
  const v = tmpA.copy(pos).project(camera);
  return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
}

const MAX_FLOAT_TEXT = 40;
let liveFloatText = 0;
function floatText(worldPos, text, color = '#fff', yOff = 0, size = 18) {
  const s = worldToScreen(worldPos);
  if (s.x < -50 || s.x > window.innerWidth + 50 || s.y < -50 || s.y > window.innerHeight + 50) return;
  if (liveFloatText >= MAX_FLOAT_TEXT) return;   // a burst can never pile up hundreds of divs
  liveFloatText++;
  const div = document.createElement('div');
  div.className = 'float-text';
  div.style.left = `${s.x}px`;
  div.style.top = `${s.y - yOff}px`;
  div.style.color = color;
  div.style.fontSize = `${size}px`;
  div.innerHTML = text;
  floatLayer.appendChild(div);
  setTimeout(() => { div.remove(); liveFloatText--; }, 1150);
}

let bannerTimer = null;
function showBanner(text, dur = 2.5) {
  banner.textContent = text;
  banner.classList.remove('hidden');
  banner.style.animation = 'none';
  void banner.offsetWidth;
  banner.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.add('hidden'), dur * 1000);
}

/* ================= particles (ONE instanced draw call for all of them) ================= */

const PARTICLE_POOL = 400;
const particleMesh = new THREE.InstancedMesh(
  M.sphGeo(1, 6),
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
  PARTICLE_POOL
);
particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
particleMesh.frustumCulled = false;
particleMesh.castShadow = false;
particleMesh.receiveShadow = false;
for (let i = 0; i < PARTICLE_POOL; i++) particleMesh.setColorAt(i, new THREE.Color(0xffffff));
particleMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
particleMesh.count = 0;
scene.add(particleMesh);
const particleTmpMat = new THREE.Matrix4();
const particleTmpColor = new THREE.Color();
const particleTmpQ = new THREE.Quaternion();
const particleTmpS = new THREE.Vector3();

function spawnBurst(pos, color, n = 10, speed = 4, size = 0.1, life = 0.5, gravity = 7, up = 2.5) {
  const room = Math.min(particleCap, PARTICLE_POOL) - state.particles.length;
  if (room <= 0) return;
  const count = Math.min(n, room);
  for (let i = 0; i < count; i++) {
    const s = size * (0.6 + Math.random() * 0.8);
    state.particles.push({
      pos: new THREE.Vector3(
        pos.x + (Math.random() - 0.5) * 0.4,
        pos.y + (Math.random() - 0.5) * 0.4,
        pos.z + (Math.random() - 0.5) * 0.4
      ),
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.6 + up,
        (Math.random() - 0.5) * speed
      ),
      life: life * (0.7 + Math.random() * 0.6), maxLife: life, size: s, gravity, color,
    });
  }
}

function updateParticles(dt) {
  let alive = 0;
  for (const p of state.particles) {
    p.life -= dt;
    if (p.life <= 0) { p.dead = true; continue; }
    p.vel.y -= p.gravity * dt;
    p.pos.addScaledVector(p.vel, dt);
    if (p.pos.y < 0.03) { p.pos.y = 0.03; p.vel.y = 0; }
    const s = Math.max(0.001, p.size * (p.life / p.maxLife));
    particleTmpMat.compose(p.pos, particleTmpQ, particleTmpS.set(s, s, s));
    particleMesh.setMatrixAt(alive, particleTmpMat);
    particleMesh.setColorAt(alive, particleTmpColor.setHex(p.color));
    alive++;
  }
  state.particles = state.particles.filter((p) => !p.dead);
  particleMesh.count = alive;
  particleMesh.instanceMatrix.needsUpdate = true;
  particleMesh.instanceColor.needsUpdate = true;
}

/* ================= player ================= */

function initPlayer() {
  const p = M.makePlayerMesh();
  player.mesh = p.group;
  player.parts = p.parts;
  player.weaponSlot = p.weaponSlot;
  player.mesh.position.set(0, 0, 7);
  scene.add(player.mesh);
  for (const id of ['bat', 'crowbar', 'gun', 'hammer', 'suit']) {
    const wm = M.makeWeaponMesh(id);
    wm.visible = false;
    player.weaponSlot.add(wm);
    player.weaponMeshes[id] = wm;
  }
  player.suitOverlay = M.makeSuitOverlay();
  player.suitOverlay.visible = false;
  p.body.add(player.suitOverlay);
}

function selectWeapon(id) {
  if (!state.ownedWeapons[id]) return;
  player.weapon = id;
  for (const [wid, wm] of Object.entries(player.weaponMeshes)) wm.visible = wid === id;
  // own the suit = wear the suit (armor is passive, so the look matches)
  if (player.suitOverlay) player.suitOverlay.visible = !!state.ownedWeapons.suit;
  renderHotbar();
}

function renderHotbar() {
  const hb = $('hotbar');
  hb.innerHTML = '';
  WEAPON_ORDER.forEach((id, i) => {
    const w = WEAPONS[id];
    const owned = !!state.ownedWeapons[id];
    const slot = document.createElement('div');
    slot.className = 'slot' + (player.weapon === id ? ' active' : '') + (owned ? '' : ' locked');
    slot.innerHTML = `<span class="key">${i + 1}</span>${w.emoji}<small>${owned ? w.name.split(' ')[0] : '🔒'}</small>`;
    slot.title = owned ? w.name : `${w.name} — buy in shop`;
    slot.onclick = () => selectWeapon(id);
    hb.appendChild(slot);
  });
}

function damagePlayer(dmg) {
  if (player.dead || state.over) return;
  // once you own the suit, you're wearing it — armor is always on
  if (state.ownedWeapons.suit) dmg = Math.ceil(dmg * WEAPONS.suit.armor);
  player.hp -= dmg;
  sfx.playerHurt();
  if (player.hp <= 0) {
    player.hp = 0;
    player.dead = true;
    player.respawnAt = state.time + 3;
    player.mesh.visible = false;
    spawnBurst(player.mesh.position, 0x64b5f6, 14, 4, 0.12, 0.7);
    showBanner('😵 Knocked out! Respawning...', 2.8);
  }
}

function updatePlayer(dt) {
  if (player.dead) {
    if (state.time >= player.respawnAt) {
      player.dead = false;
      player.hp = Math.round(player.max * 0.6);   // getting knocked out stings a little
      player.mesh.position.set(0, 0, 7);
      player.mesh.visible = true;
      spawnBurst(player.mesh.position, 0x8be98b, 12, 3, 0.12, 0.6);
    }
    return;
  }

  const mv = tmpA.set(
    (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
    0,
    (keys.down ? 1 : 0) - (keys.up ? 1 : 0)
  );
  const moving = mv.lengthSq() > 0;
  if (moving) {
    mv.normalize();
    player.mesh.position.addScaledVector(mv, 6 * dt);
    const len = Math.hypot(player.mesh.position.x, player.mesh.position.z);
    if (len > PLAY_BOUND) {
      player.mesh.position.x *= PLAY_BOUND / len;
      player.mesh.position.z *= PLAY_BOUND / len;
    }
    player.facing.copy(mv);
    player.walkT += dt * 9;
  } else {
    player.walkT = 0;
  }

  // aim toward mouse while attacking, else face where walking
  if (input.attacking && aimValid) {
    player.facing.copy(tmpB.subVectors(aimPoint, player.mesh.position).setY(0).normalize());
  }
  if (player.facing.lengthSq() > 0.01) {
    player.mesh.lookAt(
      player.mesh.position.x + player.facing.x, 0, player.mesh.position.z + player.facing.z
    );
  }

  // walk / swing animation
  const swing = Math.sin(player.walkT) * 0.5;
  player.parts.legL.rotation.x = swing;
  player.parts.legR.rotation.x = -swing;
  player.parts.armL.rotation.x = -swing * 0.5;
  if (player.swingT > 0) {
    player.swingT -= dt;
    player.parts.armR.rotation.x = -2.2 * Math.sin((player.swingT / 0.25) * Math.PI);
  } else {
    player.parts.armR.rotation.x = swing * 0.5;
  }

  player.attackCd -= dt;
  if (input.attacking && player.attackCd <= 0 && !state.placing) doAttack();
}

function doAttack() {
  const w = WEAPONS[player.weapon];
  player.attackCd = 1 / w.rate;
  player.swingT = 0.25;
  if (w.kind === 'repair') {
    // hammer time: fix up nearby turrets
    let fixed = false;
    for (const t of state.turrets) {
      if (t.dead || t.hp >= t.maxHp) continue;
      const d = t.group.position.distanceTo(player.mesh.position);
      if (d > w.range + 0.9) continue;
      const dir = tmpB.subVectors(t.group.position, player.mesh.position).setY(0).normalize();
      if (d > 1.4 && dir.dot(player.facing) < 0.1) continue;
      t.hp = Math.min(t.maxHp, t.hp + w.heal);
      t.hpBar.set(t.hp / t.maxHp);
      floatText(t.group.position.clone().setY(2.2), `🔨 +${w.heal}`, '#8be98b', 0, 15);
      spawnBurst(t.group.position.clone().setY(1.4), 0x8be98b, 5, 2.5, 0.07, 0.4);
      fixed = true;
    }
    if (fixed) sfx.repair(); else sfx.melee();
  } else if (w.kind === 'melee') {
    sfx.melee();
    let hit = false;
    for (const z of state.zombies) {
      if (z.dead) continue;
      const d = z.mesh.position.distanceTo(player.mesh.position);
      if (d > w.range + z.radius) continue;
      const dir = tmpB.subVectors(z.mesh.position, player.mesh.position).setY(0).normalize();
      if (dir.dot(player.facing) < 0.25) continue;
      damageZombie(z, w.damage, { showNumber: true, fromPlayer: true });
      hit = true;
    }
    if (state.boss) {
      const bp = nearestBossPoint(player.mesh.position.x, player.mesh.position.z);
      if (bp.gap < w.range) {
        damageBoss(w.damage, { showNumber: true });
        hit = true;
      }
    }
    if (hit) sfx.hit();
  } else {
    sfx.playerShoot();
    const origin = player.mesh.position.clone().setY(1.1).addScaledVector(player.facing, 0.5);
    const bullet = M.makeBulletMesh(0x00e5ff);
    bullet.position.copy(origin);
    scene.add(bullet);
    state.projectiles.push({
      kind: 'friendly', mesh: bullet,
      vel: player.facing.clone().multiplyScalar(26),
      damage: w.damage, life: w.range / 26, fromPlayer: true,
    });
  }
}

/* ================= zombies ================= */

// Hard ceiling on simultaneous zombies — bounds draw calls and the n² separation loop.
const MAX_ZOMBIES_ALIVE = 60;

function spawnZombie(type, pos = null) {
  if (state.zombies.length >= MAX_ZOMBIES_ALIVE) return null;
  const def = ZOMBIES[type];
  const zm = M.makeZombieMesh(type);
  if (pos) {
    zm.group.position.copy(pos).setY(0);
  } else {
    const a = Math.random() * Math.PI * 2;
    zm.group.position.set(Math.cos(a) * FIELD_RADIUS, 0, Math.sin(a) * FIELD_RADIUS);
  }
  scene.add(zm.group);

  const hpBar = M.makeHpBar(1.1);
  hpBar.group.position.y = zm.barY;
  zm.group.add(hpBar.group);
  hpBar.set(1);

  const maxHp = Math.round(def.hp * zombieHpScale(state.wave));
  state.zombies.push({
    type, def, mesh: zm.group, body: zm.body, parts: zm.parts,
    hp: maxHp, maxHp, hpBar,
    radius: type === 'buff' ? 0.9 : (type === 'stone' || type === 'hockey') ? 0.7 : 0.55,
    blocksLeft: def.blocks || 0,
    attackCd: 1, abilityCd: 3 + Math.random() * 3, aggroUntil: 0, stunUntil: 0,
    walkT: Math.random() * 10, attackAnim: 0, attackAnimDur: 0.3, spin: 0,
    vel: new THREE.Vector3(),
    dead: false,
  });
}

function nearestTurret(pos, exclude = null) {
  let best = null, bd = Infinity;
  for (const t of state.turrets) {
    if (t.dead || t === exclude) continue;
    const d = t.group.position.distanceTo(pos);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

function strongestTurret(excludeStunned = false) {
  let best = null, bp = -1;
  for (const t of state.turrets) {
    if (t.dead) continue;
    if (excludeStunned && state.time < t.stunUntil) continue;
    const power = t.def.damage * t.dmgMult;
    if (power > bp) { bp = power; best = t; }
  }
  return best;
}

function damageZombie(z, dmg, opts = {}) {
  if (z.dead) return 'dead';
  if (opts.fromPlayer) z.aggroUntil = state.time + 4;   // shot zombies chase you
  if (z.blocksLeft > 0) {
    z.blocksLeft--;
    sfx.block();
    floatText(z.mesh.position.clone().setY(2), `🛡️ BLOCK! (${z.blocksLeft} left)`, '#dddddd', 0, 14);
    spawnBurst(z.mesh.position.clone().setY(1.2), 0xdddddd, 4, 3, 0.07, 0.3);
    return 'blocked';
  }
  z.hp -= dmg;
  z.hpBar.set(z.hp / z.maxHp);
  if (opts.showNumber) floatText(z.mesh.position.clone().setY(2), `-${Math.round(dmg)}`, '#ff8a65', 0, 15);
  if (z.hp <= 0) { killZombie(z); return 'killed'; }
  return 'hit';
}

function killZombie(z) {
  if (z.dead) return;
  z.dead = true;
  state.stats.kills++;
  // killing the hacker frees its hacked turrets
  if (z.def.hackCooldown) {
    for (const t of state.turrets) {
      if (t.hackedBy === z) { t.hackedUntil = 0; t.hackedBy = null; }
    }
  }
  sfx.zombieDie();
  spawnBurst(z.mesh.position.clone().setY(1), 0x6abf4b, 14, 4, 0.12, 0.6);
  const reward = z.def.reward + Math.floor(state.wave / 3);
  state.money += reward;
  floatText(z.mesh.position.clone().setY(1.6), `+💵${reward}`, '#8be98b');
  if (Math.random() < 0.05) {
    state.diamonds += 1;
    floatText(z.mesh.position.clone().setY(1.6), `+💎1`, '#7fdcff', 28);
    sfx.gem();
  }
  updateCurrencies();
  scene.remove(z.mesh);
}

function updateZombie(z, dt) {
  if (z.dead) return;
  const def = z.def;
  const pos = z.mesh.position;
  const dmgScale = zombieDmgScale(state.wave);

  // dissolving in acid (acid turret): continuous damage
  if (state.time < z.acidUntil) {
    z.hp -= z.acidDps * dt;
    z.hpBar.set(z.hp / z.maxHp);
    z.acidAcc = (z.acidAcc || 0) + dt;
    if (z.acidAcc > 0.25) {
      z.acidAcc = 0;
      spawnBurst(pos.clone().setY(1.1), 0x7ee24a, 1, 1.2, 0.08, 0.4, 5, 0.6);
    }
    if (z.hp <= 0) { killZombie(z); return; }
  }

  // stunned by a dust turret: wobble dizzily and do nothing
  if (state.time < z.stunUntil) {
    z.vel.set(0, 0, 0);   // stop turret lead-aim from whiffing a stationary zombie
    z.mesh.rotation.y += 2.5 * dt;
    return;
  }

  /* ---- special abilities ---- */
  z.abilityCd -= dt;

  // Dust zombie: spawn small sandstorms that wreck turrets
  if (def.stormCooldown && z.abilityCd <= 0) {
    const near = nearestTurret(pos);
    if (near && near.group.position.distanceTo(pos) < def.stormRange) {
      let spawned = 0;
      for (let i = 0; i < def.stormCount; i++) {
        const live = state.turrets.filter((t) => !t.dead);
        const target = live[Math.floor(Math.random() * live.length)] || near;
        const p = pos.clone();
        p.x += (Math.random() - 0.5) * 3;
        p.z += (Math.random() - 0.5) * 3;
        if (spawnSandstorm(p, { scale: 1, life: def.stormTime, dps: def.stormDps, radius: 1.8, target })) spawned++;
      }
      if (spawned > 0) {
        z.abilityCd = def.stormCooldown;
        z.attackAnim = 0.3;
        sfx.storm();
        floatText(pos.clone().setY(2.4), '🌪️ SANDSTORMS!', '#e8c37a');
      } else {
        z.abilityCd = 1.5;   // storm pool full — try again shortly, no fake announcement
      }
    }
  }

  // Soccer zombie: kick a stunning soccer ball at your MOST POWERFUL turret
  // (skips turrets that are already stunned so stuns don't stack forever)
  if (def.kickCooldown && z.abilityCd <= 0) {
    const target = strongestTurret(true);
    if (target && target.group.position.distanceTo(pos) < def.kickRange) {
      z.abilityCd = def.kickCooldown;
      z.attackAnim = 0.3;
      const ball = M.makeSoccerBallMesh();
      ball.position.copy(pos).setY(0.4);
      scene.add(ball);
      const to = tmpA.subVectors(target.group.position, pos);
      const dist = Math.hypot(to.x, to.z);
      const T = Math.max(0.4, dist / 12);
      state.projectiles.push({
        kind: 'soccer', mesh: ball,
        vel: new THREE.Vector3(to.x / T, 0.5 * 9.8 * T, to.z / T),
        target, life: T + 1, stunTime: def.stunTime,
      });
      floatText(pos.clone().setY(2.2), '⚽ KICK!', '#ffffff');
    }
  }

  // Hacker zombie: hack a nearby turret so it shoots OTHER turrets
  if (def.hackCooldown && z.abilityCd <= 0) {
    const target = nearestTurret(pos);
    if (target && target.group.position.distanceTo(pos) < def.hackRange) {
      z.abilityCd = def.hackCooldown;
      z.attackAnim = 0.3;
      target.hackedUntil = state.time + def.hackTime;
      target.hackedBy = z;
      sfx.hack();
      spawnBurst(target.group.position.clone().setY(1.4), 0x00ff66, 16, 4, 0.1, 0.7);
      floatText(target.group.position.clone().setY(2.4), '💻 HACKED!', '#00ff66');
    }
  }

  /* ---- pick movement target ---- */
  let tgt;
  const playerDist = player.dead ? Infinity : pos.distanceTo(player.mesh.position);
  if (playerDist < 2.6 || (z.aggroUntil > state.time && playerDist < 10)) {
    tgt = { kind: 'player', pos: player.mesh.position, reach: 1.5 };
  } else {
    let turret = null;
    if (def.kickCooldown) {
      // Soccer zombies hunt your most powerful turret, per the spec.
      turret = strongestTurret();
    } else {
      const near = nearestTurret(pos);
      if (near && near.group.position.distanceTo(pos) < TURRET_AGGRO_RANGE) turret = near;
    }
    if (turret) tgt = { kind: 'turret', obj: turret, pos: turret.group.position, reach: 1.9 };
    else tgt = { kind: 'base', pos: tmpB.set(0, 0, 0), reach: 5.2 };
  }

  const d = pos.distanceTo(tgt.pos);

  // Baseball zombie throws from range instead of walking all the way in
  let throwing = false;
  if (def.throwRange && tgt.kind === 'turret' && d < def.throwRange && d > tgt.reach) {
    throwing = true;
    z.attackCd -= dt;
    if (z.attackCd <= 0) {
      z.attackCd = 1 / def.attackRate;
      z.attackAnim = 0.3;
      const ballMesh = M.makeBaseballMesh();
      ballMesh.position.copy(pos).setY(1.3);
      scene.add(ballMesh);
      const dir = tmpA.subVectors(tgt.pos, pos).setY(0).normalize();
      state.projectiles.push({
        kind: 'baseball', mesh: ballMesh,
        vel: dir.clone().multiplyScalar(14).setY(0.5),
        damage: def.damage * dmgScale, life: 1.5, ignore: null,
      });
      floatText(pos.clone().setY(2.2), '⚾', '#ffffff', 0, 16);
    }
  }

  const inReach = d <= tgt.reach;

  /* ---- move ---- */
  if (!inReach && !throwing) {
    const dir = tmpA.subVectors(tgt.pos, pos).setY(0).normalize();
    // simple separation so zombies don't stack
    for (const other of state.zombies) {
      if (other === z || other.dead) continue;
      const dx = pos.x - other.mesh.position.x;
      const dz = pos.z - other.mesh.position.z;
      const dd = dx * dx + dz * dz;
      if (dd < 1 && dd > 0.0001) {
        const push = 0.6 / Math.sqrt(dd);
        dir.x += dx * push * 0.35;
        dir.z += dz * push * 0.35;
      }
    }
    dir.normalize();
    z.vel.copy(dir).multiplyScalar(def.speed);
    pos.addScaledVector(dir, def.speed * dt);
    z.walkT += dt * def.speed * 3.2;
  } else {
    z.vel.set(0, 0, 0);
    /* ---- attack ---- */
    if (!throwing && inReach) {
      z.attackCd -= dt;
      if (z.attackCd <= 0) {
        z.attackCd = 1 / def.attackRate;
        z.attackAnimDur = z.type === 'stone' ? 0.45 : 0.3;   // stone gets a longer headbutt wind-up
        z.attackAnim = z.attackAnimDur;
        const dmg = def.damage * dmgScale;
        if (tgt.kind === 'player') {
          damagePlayer(Math.round(dmg * 0.5));
        } else if (tgt.kind === 'turret') {
          damageTurret(tgt.obj, dmg);
          // Fire zombie sets turrets on fire
          if (def.burnDps) {
            tgt.obj.fireUntil = state.time + def.burnTime;
            tgt.obj.burnDps = def.burnDps;
            sfx.fire();
            floatText(tgt.pos.clone().setY(2.4), '🔥 ON FIRE!', '#ff9800');
          }
          // Acid zombie coats turrets in acid — continuous damage
          if (def.acidDps) {
            tgt.obj.acidUntil = state.time + def.acidTime;
            tgt.obj.acidDps = def.acidDps;
            sfx.acid();
            floatText(tgt.pos.clone().setY(2.4), '🧪 ACID!', '#7ee24a');
          }
          // Sword zombie cleaves a second turret
          if (def.cleaveRange) {
            const second = nearestTurret(tgt.pos, tgt.obj);
            if (second && second.group.position.distanceTo(tgt.pos) < def.cleaveRange) {
              damageTurret(second, dmg);
              floatText(second.group.position.clone().setY(2.2), '⚔️', '#fff', 0, 16);
            }
          }
        } else {
          damageBase(dmg);
        }
        sfx.hit();
      }
    }
  }

  /* ---- animation ---- */
  const isAxeAttacking = def.name === 'Axe Zombie' && inReach && tgt.kind !== 'player';
  if (isAxeAttacking) {
    z.spin += 13 * dt;                       // spin attack!
    z.mesh.rotation.y = z.spin;
  } else {
    z.spin = 0;
    z.mesh.lookAt(tgt.pos.x, 0, tgt.pos.z);
  }

  const swing = Math.sin(z.walkT) * 0.55;
  z.parts.legL.rotation.x = swing;
  z.parts.legR.rotation.x = -swing;
  if (z.parts.swirl) z.parts.swirl.rotation.y += 5 * dt;
  if (z.type !== 'hacker') {
    z.parts.armL.rotation.x = -Math.PI / 2 + Math.sin(z.walkT) * 0.12;
    z.parts.armR.rotation.x = -Math.PI / 2 - Math.sin(z.walkT) * 0.12;
  }
  if (z.attackAnim > 0) {
    z.attackAnim -= dt;
    const p = Math.max(0, z.attackAnim) / (z.attackAnimDur || 0.3);
    z.body.position.z = Math.sin(p * Math.PI) * (z.type === 'stone' ? 0.55 : 0.3);
  } else {
    z.body.position.z = 0;
  }
}

/* ================= turrets ================= */

function placeTurret(tier, pos, opts = {}) {
  const def = TURRETS[tier];
  const tm = M.makeTurretMesh(def);
  tm.group.position.copy(pos).setY(0);
  scene.add(tm.group);
  const hpBar = M.makeHpBar(1.3);
  hpBar.group.position.y = 2.25;
  tm.group.add(hpBar.group);
  hpBar.set(1);
  const t = {
    tier, def, group: tm.group, head: tm.head, hatSlot: tm.hatSlot,
    stunFx: tm.stunFx, hackFx: tm.hackFx,
    hp: def.hp, maxHp: def.hp, hpBar,
    fireCd: 0, flameAcc: 0,
    stunUntil: 0, fireUntil: 0, hackedUntil: 0, hackedBy: null, burnDps: 0,
    acidUntil: 0, acidDps: 0, acidAcc: 0,
    dmgMult: state.costumes[tier] ? 1 + COSTUME_DAMAGE_BONUS : 1,
    free: !!opts.free,   // loot gifts don't pay the emerald destruction refund
    dead: false,
  };
  if (state.costumes[tier]) tm.hatSlot.add(M.makeCostumeHat(COSTUMES[tier].style));
  state.turrets.push(t);
  sfx.place();
  return t;
}

function damageTurret(t, dmg) {
  if (t.dead) return;
  t.hp -= dmg;
  t.hpBar.set(t.hp / t.maxHp);
  spawnBurst(t.group.position.clone().setY(1.2), 0xffa726, 3, 3, 0.07, 0.3);
  if (t.hp <= 0) destroyTurret(t);
}

function destroyTurret(t) {
  if (t.dead) return;
  t.dead = true;
  // emerald turrets give back half their cost so losing one isn't crushing
  if (!t.free && t.def.cost && t.def.cost.emeralds) {
    const back = Math.floor(t.def.cost.emeralds / 2);
    if (back > 0) {
      state.emeralds += back;
      updateCurrencies();
      floatText(t.group.position.clone().setY(2.6), `+<span class="em">♦</span>${back} back!`, '#1ddb6e', 26);
    }
  }
  sfx.turretDie();
  spawnBurst(t.group.position.clone().setY(1), 0xff7043, 22, 6, 0.16, 0.8);
  spawnBurst(t.group.position.clone().setY(1), 0x616161, 14, 4, 0.14, 0.9);
  floatText(t.group.position.clone().setY(2), '💥', '#ff7043', 0, 26);
  scene.remove(t.group);
}

function shootFrom(t, targetPos, targetVel, hostile) {
  const def = t.def;
  const origin = t.group.position.clone().setY(1.2);
  const dist = origin.distanceTo(targetPos);
  const speed = 22;
  // lead the target a little
  const aim = tmpA.copy(targetPos).addScaledVector(targetVel || tmpB.set(0, 0, 0), dist / speed);
  const dir = aim.sub(origin).setY(hostile ? 0 : 0.1).normalize();
  // costumed turrets shoot costume-colored shots (the mustard turret shoots MUSTARD!)
  const costume = COSTUMES[t.tier];
  const dressed = !hostile && state.costumes[t.tier] && costume && costume.projColor;
  const bullet = M.makeBulletMesh(hostile ? 0x00ff66 : (dressed ? costume.projColor : def.rarityColor));
  if (dressed) bullet.scale.setScalar(1.4);   // a proper glob of mustard
  bullet.position.copy(origin).addScaledVector(dir, 0.85);
  scene.add(bullet);
  state.projectiles.push({
    kind: hostile ? 'hacked' : 'friendly',
    mesh: bullet, vel: dir.clone().multiplyScalar(speed),
    // hacked turrets shoot other turrets at reduced power so one hack can't wipe you out
    damage: def.damage * t.dmgMult * (hostile ? 0.25 : 1),
    life: (def.range + 4) / speed,
    ignore: t,
    // dust turret sand-blast: pushes zombies back, chance to stun
    knockback: def.knockback || 0,
    stunChance: def.stunChance || 0,
    stunTime: def.stunTime || 0,
    // acid turret shots keep hurting after the hit
    acidDps: def.acidDps || 0,
    acidTime: def.acidTime || 0,
  });
  sfx.shoot();
}

function updateTurret(t, dt) {
  if (t.dead) return;

  // coated in acid (acid zombie): continuous damage with green drips
  if (state.time < t.acidUntil) {
    t.hp -= t.acidDps * dt;
    t.hpBar.set(t.hp / t.maxHp);
    t.acidAcc += dt;
    if (t.acidAcc > 0.2) {
      t.acidAcc = 0;
      const p = t.group.position.clone();
      p.x += (Math.random() - 0.5) * 0.8;
      p.z += (Math.random() - 0.5) * 0.8;
      p.y = 0.5 + Math.random() * 1.2;
      spawnBurst(p, 0x7ee24a, 1, 0.5, 0.1, 0.5, 4, 0.3);
    }
    if (t.hp <= 0) { destroyTurret(t); return; }
  }

  // burning (fire zombie)
  if (state.time < t.fireUntil) {
    t.hp -= (t.burnDps || 6) * dt;
    t.hpBar.set(t.hp / t.maxHp);
    t.flameAcc += dt;
    if (t.flameAcc > 0.08) {
      t.flameAcc = 0;
      const p = t.group.position.clone();
      p.x += (Math.random() - 0.5) * 0.7;
      p.z += (Math.random() - 0.5) * 0.7;
      p.y = 0.6 + Math.random() * 1.2;
      spawnBurst(p, Math.random() < 0.5 ? 0xff6d00 : 0xffa726, 1, 0.6, 0.13, 0.45, -3, 1.5);
    }
    if (t.hp <= 0) { destroyTurret(t); return; }
  }

  const stunned = state.time < t.stunUntil;
  t.stunFx.visible = stunned;
  if (stunned) t.stunFx.rotation.y += 4 * dt;

  const hacked = state.time < t.hackedUntil;
  t.hackFx.visible = hacked;
  if (hacked) t.hackFx.rotation.y += 3 * dt;

  if (stunned) return;

  t.fireCd -= dt;

  if (hacked) {
    // hacked turrets shoot OTHER turrets!
    const victim = nearestTurret(t.group.position, t);
    if (victim) {
      const dx = victim.group.position.x - t.group.position.x;
      const dz = victim.group.position.z - t.group.position.z;
      t.head.rotation.y = Math.atan2(dx, dz);
      if (t.fireCd <= 0 && Math.hypot(dx, dz) < t.def.range) {
        t.fireCd = 1 / t.def.fireRate;
        shootFrom(t, victim.group.position.clone().setY(1.2), null, true);
      }
    }
    return;
  }

  // normal targeting: nearest zombie (or the boss) in range.
  // Acid turrets prefer zombies that aren't already melting, to spread the DoT.
  let best = null, bd = Infinity;
  let bestFresh = null, bdFresh = Infinity;
  const wantsFresh = !!t.def.acidDps;
  for (const z of state.zombies) {
    if (z.dead) continue;
    const d = z.mesh.position.distanceTo(t.group.position);
    if (d >= t.def.range) continue;
    if (d < bd) { bd = d; best = z; }
    if (wantsFresh && state.time >= z.acidUntil && d < bdFresh) { bdFresh = d; bestFresh = z; }
  }
  if (bestFresh) { best = bestFresh; bd = bdFresh; }
  let bossTarget = false;
  let bossAim = null;
  if (state.boss) {
    const np = nearestBossPoint(t.group.position.x, t.group.position.z);
    const d = Math.max(0.1, np.gap);
    if (d < bd && np.gap < t.def.range) {
      bd = d; best = state.boss; bossTarget = true;
      bossAim = tmpB.set(np.x, 0, np.z).clone();
    }
  }
  if (best) {
    const bp = bossTarget ? bossAim : best.mesh.position;
    const dx = bp.x - t.group.position.x;
    const dz = bp.z - t.group.position.z;
    t.head.rotation.y = Math.atan2(dx, dz);
    if (t.fireCd <= 0) {
      t.fireCd = 1 / t.def.fireRate;
      shootFrom(t, bp.clone().setY(bossTarget ? 2 : 1.1), bossTarget ? null : best.vel, false);
    }
  }
}

/* ================= projectiles ================= */

function updateProjectile(pr, dt) {
  pr.life -= dt;
  if (pr.life <= 0) { pr.dead = true; scene.remove(pr.mesh); return; }

  if (pr.kind === 'soccer') {
    pr.vel.y -= 9.8 * dt;
    pr.mesh.position.addScaledVector(pr.vel, dt);
    pr.mesh.rotation.x += 8 * dt;
    const t = pr.target;
    const near = t && !t.dead &&
      Math.hypot(pr.mesh.position.x - t.group.position.x, pr.mesh.position.z - t.group.position.z) < 1.4;
    if (near || pr.mesh.position.y < 0.15) {
      if (near) {
        t.stunUntil = state.time + pr.stunTime;
        sfx.stun();
        floatText(t.group.position.clone().setY(2.4), `😵 STUNNED ${pr.stunTime}s!`, '#ffe14f');
        spawnBurst(t.group.position.clone().setY(1.6), 0xffe14f, 12, 3.5, 0.1, 0.6);
      }
      pr.dead = true;
      scene.remove(pr.mesh);
    }
    return;
  }

  pr.mesh.position.addScaledVector(pr.vel, dt);

  if (pr.kind === 'friendly') {
    for (const z of state.zombies) {
      if (z.dead) continue;
      if (pr.mesh.position.distanceTo(z.mesh.position.clone().setY(pr.mesh.position.y)) < z.radius + 0.4) {
        const result = damageZombie(z, pr.damage, { showNumber: pr.fromPlayer });
        if (pr.acidDps && !z.dead && result !== 'blocked') {
          z.acidUntil = state.time + pr.acidTime;
          z.acidDps = pr.acidDps;
          spawnBurst(z.mesh.position.clone().setY(1.2), 0x7ee24a, 4, 2, 0.08, 0.4);
        }
        if (pr.knockback && !z.dead && result !== 'blocked') {
          // sand blast! push the zombie back
          const dBefore = Math.hypot(z.mesh.position.x, z.mesh.position.z);
          const push = tmpB.copy(pr.vel).setY(0).normalize().multiplyScalar(pr.knockback);
          z.mesh.position.add(push);
          const len = Math.hypot(z.mesh.position.x, z.mesh.position.z);
          if (len > FIELD_RADIUS + 2) {
            z.mesh.position.x *= (FIELD_RADIUS + 2) / len;
            z.mesh.position.z *= (FIELD_RADIUS + 2) / len;
          }
          // getting punted across the barbed wire still hurts
          if (state.baseLevel >= 2) {
            const bdef = BASE_LEVELS[state.baseLevel];
            const dAfter = Math.hypot(z.mesh.position.x, z.mesh.position.z);
            if ((dBefore - bdef.wireRadius) * (dAfter - bdef.wireRadius) <= 0) {
              z.hp -= bdef.wireDps * 0.8;
              z.hpBar.set(z.hp / z.maxHp);
              spawnBurst(z.mesh.position.clone().setY(0.6), 0xef5350, 3, 2, 0.06, 0.3);
              if (z.hp <= 0) killZombie(z);
            }
          }
          spawnBurst(z.mesh.position.clone().setY(1), 0xd8b06a, 6, 3, 0.09, 0.4);
          if (Math.random() < pr.stunChance) {
            z.stunUntil = state.time + pr.stunTime;
            z.vel.set(0, 0, 0);
            floatText(z.mesh.position.clone().setY(2.2), '😵 STUNNED!', '#e8c37a', 0, 15);
          }
        } else {
          spawnBurst(pr.mesh.position, 0xffe14f, 4, 3, 0.06, 0.25);
        }
        pr.dead = true;
        scene.remove(pr.mesh);
        return;
      }
    }
    const b = state.boss;
    if (b) {
      const bp = nearestBossPoint(pr.mesh.position.x, pr.mesh.position.z);
      if (bp.gap < 0.4) {
        damageBoss(pr.damage, { showNumber: pr.fromPlayer });
        // acid sticks to the worm too
        if (pr.acidDps && state.boss === b) {
          b.acidUntil = state.time + pr.acidTime;
          b.acidDps = pr.acidDps;
        }
        // dust turret sand slows the giant worm down
        if (pr.knockback && state.boss === b) {
          const alreadySlow = state.time < b.slowUntil;
          b.slowUntil = state.time + 2;
          if (!alreadySlow) floatText(b.group.position.clone().setY(5.5), '🌪️ SAND IN ITS EYES!', '#e8c37a', 0, 18);
        }
        spawnBurst(pr.mesh.position, 0xffe14f, 4, 3, 0.06, 0.25);
        pr.dead = true;
        scene.remove(pr.mesh);
        return;
      }
    }
  } else if (pr.kind === 'hacked' || pr.kind === 'baseball') {
    for (const t of state.turrets) {
      if (t.dead || t === pr.ignore) continue;
      if (Math.hypot(pr.mesh.position.x - t.group.position.x, pr.mesh.position.z - t.group.position.z) < 1) {
        damageTurret(t, pr.damage);
        pr.dead = true;
        scene.remove(pr.mesh);
        return;
      }
    }
  }
}

/* ================= traps ================= */

function placeTrap(pos) {
  const mesh = M.makeTrapMesh();
  mesh.position.copy(pos).setY(0);
  scene.add(mesh);
  state.traps.push({ mesh, uses: ITEMS.trap.uses, cd: 0, dead: false });
  sfx.place();
}

function updateTrap(tr, dt) {
  tr.cd -= dt;
  if (tr.cd > 0) return;
  for (const z of state.zombies) {
    if (z.dead) continue;
    if (z.mesh.position.distanceTo(tr.mesh.position) < 1.05) {
      tr.cd = 0.7;
      tr.uses--;
      damageZombie(z, ITEMS.trap.damage, { showNumber: true });
      spawnBurst(tr.mesh.position.clone().setY(0.3), 0xb0bec5, 5, 2.5, 0.07, 0.3);
      if (tr.uses <= 0) {
        tr.dead = true;
        scene.remove(tr.mesh);
        spawnBurst(tr.mesh.position.clone().setY(0.2), 0x4e4238, 8, 2, 0.1, 0.5);
      }
      break;
    }
  }
}

/* ================= sandstorms ================= */

function spawnSandstorm(pos, { scale = 1, life = 3, dps = 25, radius = 1.8, target = null, priority = false } = {}) {
  if (state.storms.length >= 12) {
    if (!priority) return false;
    const oldest = state.storms.shift();   // the boss's giant storm always lands
    scene.remove(oldest.mesh);
  }
  const mesh = M.makeSandstormMesh(scale);
  mesh.position.copy(pos).setY(0);
  scene.add(mesh);
  state.storms.push({ mesh, life, dps, radius, target, dead: false, puffAcc: 0 });
  return true;
}

// Nearest hittable point on the boss (head or any body segment) in world space.
const bossPointTmp = new THREE.Vector3();
function nearestBossPoint(x, z) {
  const b = state.boss;
  let px = b.group.position.x, pz = b.group.position.z;
  let gap = Math.hypot(x - px, z - pz) - 2.9;   // head radius (scaled)
  for (const seg of b.segments) {
    seg.getWorldPosition(bossPointTmp);
    const r = seg.scale.x * b.group.scale.x;
    const g = Math.hypot(x - bossPointTmp.x, z - bossPointTmp.z) - r;
    if (g < gap) { gap = g; px = bossPointTmp.x; pz = bossPointTmp.z; }
  }
  return { x: px, z: pz, gap };
}

function updateStorm(st, dt) {
  st.life -= dt;
  if (st.life <= 0) {
    st.dead = true;
    scene.remove(st.mesh);
    return;
  }
  st.mesh.rotation.y += 5 * dt;

  // drift toward its target turret (retarget if it died)
  if (!st.target || st.target.dead) st.target = nearestTurret(st.mesh.position);
  if (st.target) {
    const dir = tmpA.subVectors(st.target.group.position, st.mesh.position).setY(0);
    if (dir.lengthSq() > 0.5) st.mesh.position.addScaledVector(dir.normalize(), 2.4 * dt);
  }

  // sand-blast any turret inside the storm (smooth DoT, no per-frame hit sparks)
  for (const t of state.turrets) {
    if (t.dead) continue;
    if (t.group.position.distanceTo(st.mesh.position) < st.radius) {
      t.hp -= st.dps * dt;
      t.hpBar.set(t.hp / t.maxHp);
      if (t.hp <= 0) destroyTurret(t);
    }
  }

  st.puffAcc += dt;
  if (st.puffAcc > 0.15) {
    st.puffAcc = 0;
    const p = st.mesh.position.clone();
    p.x += (Math.random() - 0.5) * st.radius;
    p.z += (Math.random() - 0.5) * st.radius;
    p.y = 0.3 + Math.random() * 1.5 * (st.radius / 1.8);
    spawnBurst(p, 0xd8b06a, 1, 1, 0.12, 0.5, -2, 1);
  }
}

/* ================= the desert & its boss ================= */

function switchToDesert() {
  state.desert = true;
  const oldMap = ground.material.map;
  ground.material.map = M.makeGroundTexture('desert');
  ground.material.needsUpdate = true;
  if (oldMap) oldMap.dispose();
  scene.background = new THREE.Color(0xf2c98c);
  scene.fog.color.set(0xf2c98c);
  for (const t of trees) scene.remove(t);
  for (let i = 0; i < 10; i++) {
    const cactus = M.makeCactus();
    const a = Math.random() * Math.PI * 2;
    const r = 32 + Math.random() * 10;
    cactus.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    cactus.rotation.y = Math.random() * Math.PI;
    scene.add(cactus);
  }
  const pyr1 = M.makePyramid(); pyr1.position.set(-30, 0, -26); scene.add(pyr1);
  const pyr2 = M.makePyramid(); pyr2.position.set(31, 0, 24); pyr2.scale.setScalar(1.4); scene.add(pyr2);
  sfx.storm();
}

function spawnBoss() {
  const wb = M.makeWormBoss();
  const a = Math.random() * Math.PI * 2;
  wb.group.position.set(Math.cos(a) * (FIELD_RADIUS - 3), 0, Math.sin(a) * (FIELD_RADIUS - 3));
  scene.add(wb.group);
  const cycle = Math.max(0, Math.round((state.wave - DESERT_START_WAVE) / BOSS_EVERY));
  const hpScale = 1 + 0.12 * cycle;
  const maxHp = Math.round(BOSS.hp * hpScale);
  state.boss = {
    def: BOSS, group: wb.group, head: wb.head, segments: wb.segments,
    hp: maxHp, maxHp, hpScale, cycle,
    biteCd: 1.5, slashCd: 2, stormCd: 8, quakeCd: 14, summonCd: 10,
    slashT: 0, slowUntil: 0, acidUntil: 0, acidDps: 0, acidAcc: 0, t: Math.random() * 10,
  };
  sfx.roar();
  spawnBurst(wb.group.position.clone().setY(1), 0xd8b06a, 30, 7, 0.2, 1, 6, 4);
  $('boss-wrap').classList.remove('hidden');
  $('boss-fill').style.width = '100%';
}

function damageBoss(dmg, opts = {}) {
  const b = state.boss;
  if (!b) return;
  b.hp -= dmg;
  setWidth('boss-fill', (b.hp / b.maxHp) * 100);
  if (opts.showNumber) floatText(b.group.position.clone().setY(5), `-${Math.round(dmg)}`, '#ff8a65', 0, 16);
  if (b.hp <= 0) {
    sfx.bossDie();
    // tougher repeat bosses pay proportionally more
    const r = {
      money: Math.round(BOSS.reward.money * b.hpScale),
      diamonds: Math.round(BOSS.reward.diamonds * b.hpScale),
      emeralds: Math.round(BOSS.reward.emeralds * b.hpScale),
    };
    state.money += r.money;
    state.diamonds += r.diamonds;
    state.emeralds += r.emeralds;
    updateCurrencies();
    const p = b.group.position.clone();
    floatText(p.clone().setY(4), `+💵${r.money}`, '#8be98b', 0, 24);
    floatText(p.clone().setY(4), `+💎${r.diamonds}`, '#7fdcff', 30, 24);
    floatText(p.clone().setY(4), `+<span class="em">♦</span>${r.emeralds}`, '#1ddb6e', 60, 24);
    spawnBurst(p.clone().setY(2), 0xc98a6d, 30, 8, 0.25, 1.1, 6, 5);
    spawnBurst(p.clone().setY(2), 0x7cb342, 20, 6, 0.18, 1, 6, 4);
    scene.remove(b.group);
    state.boss = null;
    $('boss-wrap').classList.add('hidden');
    showBanner('🎉 BOSS DEFEATED! 🎉', 3);
  }
}

function updateBoss(dt) {
  const b = state.boss;
  if (!b) return;
  const def = b.def;
  const pos = b.group.position;
  b.t += dt;

  // acid melts even a giant worm
  if (state.time < b.acidUntil) {
    b.acidAcc += dt;
    if (b.acidAcc > 0.25) {
      b.acidAcc = 0;
      spawnBurst(pos.clone().setY(2.5), 0x7ee24a, 2, 2, 0.14, 0.5);
    }
    damageBoss(b.acidDps * dt);
    if (!state.boss) return;   // acid finished it off
  }

  /* ---- abilities ---- */
  b.stormCd -= dt;
  if (b.stormCd <= 0) {
    b.stormCd = def.stormCooldown;
    const target = strongestTurret() || null;
    spawnSandstorm(pos.clone(), { scale: 3, life: def.stormTime, dps: def.stormDps, radius: def.stormRadius, target, priority: true });
    sfx.storm();
    floatText(pos.clone().setY(5.5), '🌪️ GIANT SANDSTORM!', '#e8c37a', 0, 24);
  }

  b.quakeCd -= dt;
  if (b.quakeCd <= 0) {
    b.quakeCd = def.quakeCooldown;
    state.shakeT = 0.9;
    sfx.quake();
    floatText(pos.clone().setY(5.5), '🌋 EARTHQUAKE!', '#ff8a65', 0, 26);
    for (const t of state.turrets) {
      if (t.dead) continue;
      spawnBurst(t.group.position.clone().setY(0.4), 0x8d6e63, 6, 3, 0.12, 0.6);
      damageTurret(t, def.quakeTurretDamage);
    }
    if (!player.dead) damagePlayer(def.quakePlayerDamage);
  }

  b.summonCd -= dt;
  if (b.summonCd <= 0) {
    b.summonCd = def.summonCooldown;
    const n = def.summonCount + b.cycle;   // later bosses summon more
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = pos.clone();
      p.x += Math.cos(a) * 4;
      p.z += Math.sin(a) * 4;
      spawnZombie('dust', p);
    }
    sfx.roar();
    floatText(pos.clone().setY(5.5), `🪱 SUMMONS ${n} DUST ZOMBIES!`, '#7cb342', 0, 22);
  }

  // slash at the player when they get close
  b.slashCd -= dt;
  if (b.slashT > 0) b.slashT -= dt;
  if (!player.dead && b.slashCd <= 0 && pos.distanceTo(player.mesh.position) < def.slashRange) {
    b.slashCd = def.slashCooldown;
    b.slashT = 0.35;
    damagePlayer(def.slashDamage);
    floatText(player.mesh.position.clone().setY(2.4), '🗡️ SLASHED!', '#ff5252');
    sfx.playerHurt();
  }

  /* ---- move & bite ---- */
  let tgt, reach;
  const near = nearestTurret(pos);
  const turret = near && near.group.position.distanceTo(pos) < 28 ? near : null;
  if (turret) { tgt = turret.group.position; reach = def.biteReach; }
  else { tgt = tmpB.set(0, 0, 0); reach = 6; }
  const d = pos.distanceTo(tgt);
  const speed = def.speed * (state.time < b.slowUntil ? 0.5 : 1);   // sand in its eyes
  if (d > reach) {
    const dir = tmpA.subVectors(tgt, pos).setY(0).normalize();
    pos.addScaledVector(dir, speed * dt);
    b.group.lookAt(tgt.x, 0, tgt.z);
  } else {
    b.biteCd -= dt;
    if (b.biteCd <= 0) {
      b.biteCd = 1 / def.biteRate;
      b.slashT = 0.35;
      if (turret) damageTurret(turret, def.biteDamage);
      else damageBase(def.biteDamage);
      sfx.hit();
      floatText(tmpA.copy(tgt).setY(2.6), '🦷 CHOMP!', '#fff', 0, 18);
    }
  }

  /* ---- slither animation ---- */
  b.head.position.y = 2.1 + Math.sin(b.t * 2.4) * 0.35;
  b.head.rotation.z = b.slashT > 0 ? Math.sin((b.slashT / 0.35) * Math.PI) * 0.8 : 0;
  b.segments.forEach((seg, i) => {
    seg.position.x = Math.sin(b.t * 2 - i * 0.9) * 0.55;
    seg.position.y = (1.35 - i * 0.14) * 0.8 + Math.sin(b.t * 2.4 - i * 1.1) * 0.25;
  });
}

/* ================= helper robot ================= */

function buyRobot() {
  if (state.robot) return;
  const rm = M.makeRobotMesh();
  rm.group.position.copy(player.mesh.position).add(tmpA.set(1.5, 0, 1.5));
  scene.add(rm.group);
  state.robot = { mesh: rm.group, parts: rm, tool: null, actCd: 0, bobT: 0 };
  sfx.robot();
  floatText(rm.group.position.clone().setY(2), '🤖 BEEP BOOP!', '#00e5ff');
}

function giveRobotTool(toolId) {
  const r = state.robot;
  if (!r || !state.ownedWeapons[toolId]) return;
  r.tool = toolId;
  r.parts.toolSlot.clear();
  r.parts.toolSlot.add(M.makeWeaponMesh(toolId));
  r.parts.armR.rotation.x = -0.6;
  sfx.robot();
  floatText(r.mesh.position.clone().setY(2), `🤖 got the ${WEAPONS[toolId].name}!`, '#00e5ff');
}

function updateRobot(dt) {
  const r = state.robot;
  if (!r) return;
  r.bobT += dt;
  r.actCd -= dt;

  let targetPos = null, targetTurret = null, targetZombie = null;
  if (r.tool === 'hammer') {
    let bd = ROBOT.seekRange;
    for (const t of state.turrets) {
      if (t.dead || t.hp >= t.maxHp) continue;
      const d = t.group.position.distanceTo(r.mesh.position);
      if (d < bd) { bd = d; targetTurret = t; }
    }
    if (targetTurret) targetPos = targetTurret.group.position;
  } else if (r.tool === 'bat' || r.tool === 'crowbar') {
    let bd = ROBOT.seekRange;
    for (const z of state.zombies) {
      if (z.dead) continue;
      if (Math.hypot(z.mesh.position.x, z.mesh.position.z) > PLAY_BOUND) continue;  // wait till they're in the field
      const d = z.mesh.position.distanceTo(r.mesh.position);
      if (d < bd) { bd = d; targetZombie = z; }
    }
    if (targetZombie) targetPos = targetZombie.mesh.position;
    // no zombies around? the giant worm is fair game
    if (!targetZombie && state.boss) {
      const bp = nearestBossPoint(r.mesh.position.x, r.mesh.position.z);
      if (bp.gap < ROBOT.seekRange) {
        if (bp.gap > 1.6) {
          const dir = tmpA.set(bp.x - r.mesh.position.x, 0, bp.z - r.mesh.position.z).normalize();
          r.mesh.position.addScaledVector(dir, ROBOT.speed * dt);
          r.mesh.lookAt(bp.x, 0, bp.z);
        } else if (r.actCd <= 0) {
          const w = WEAPONS[r.tool];
          r.actCd = 1 / w.rate;
          damageBoss(Math.round(w.damage * 0.8), { showNumber: false });
          sfx.hit();
          r.parts.armR.rotation.x = -1.6;
        }
        r.mesh.position.y = 0.03 + Math.abs(Math.sin(r.bobT * 5)) * 0.06;
        return;
      }
    }
  }

  if (!targetPos) {
    // nothing to do — roll along with the player
    const d = r.mesh.position.distanceTo(player.mesh.position);
    if (d > ROBOT.followDist) {
      const dir = tmpA.subVectors(player.mesh.position, r.mesh.position).setY(0).normalize();
      r.mesh.position.addScaledVector(dir, ROBOT.speed * dt);
      r.mesh.lookAt(player.mesh.position.x, 0, player.mesh.position.z);
    }
  } else {
    const reach = targetTurret ? 1.8 : 1.4 + (targetZombie ? targetZombie.radius : 0);
    const d = r.mesh.position.distanceTo(targetPos);
    if (d > reach) {
      const dir = tmpA.subVectors(targetPos, r.mesh.position).setY(0).normalize();
      r.mesh.position.addScaledVector(dir, ROBOT.speed * dt);
      r.mesh.lookAt(targetPos.x, 0, targetPos.z);
    } else if (r.actCd <= 0) {
      if (targetTurret) {
        r.actCd = 1 / ROBOT.repairRate;
        targetTurret.hp = Math.min(targetTurret.maxHp, targetTurret.hp + ROBOT.repairAmount);
        targetTurret.hpBar.set(targetTurret.hp / targetTurret.maxHp);
        floatText(targetPos.clone().setY(2.2), `🔨 +${ROBOT.repairAmount}`, '#8be98b', 0, 13);
        spawnBurst(targetPos.clone().setY(1.4), 0x8be98b, 3, 2, 0.06, 0.3);
        sfx.repair();
        r.parts.armR.rotation.x = -1.6;
      } else if (targetZombie) {
        const w = WEAPONS[r.tool];
        r.actCd = 1 / w.rate;
        damageZombie(targetZombie, Math.round(w.damage * 0.8), { showNumber: true });
        sfx.hit();
        r.parts.armR.rotation.x = -1.6;
      }
    }
  }
  // bob + arm swing recovery
  r.mesh.position.y = 0.03 + Math.abs(Math.sin(r.bobT * 5)) * 0.06;
  r.parts.armR.rotation.x += (-(r.tool ? 0.6 : 0) - r.parts.armR.rotation.x) * Math.min(1, 6 * dt);
}

/* ================= squad allies (rescued people who fight!) ================= */

function recruitAlly(person) {
  const weapon = ALLY_WEAPONS[irand(ALLY_WEAPONS.length - 1)];
  const slot = new THREE.Group();
  slot.position.set(0, -0.5, 0);
  person.parts.armR.add(slot);
  slot.add(M.makeWeaponMesh(weapon));
  state.allies.push({
    mesh: person.group, parts: person.parts, weapon,
    attackCd: 0, walkT: 0, swingT: 0,
  });
  sfx.recruit();
  floatText(person.group.position.clone().setY(2.6), `🎉 JOINED YOUR SQUAD! (${WEAPONS[weapon].emoji})`, '#ffe14f', 0, 18);
}

function updateAlly(a, i, dt) {
  const w = WEAPONS[a.weapon];
  a.attackCd -= dt;
  if (a.swingT > 0) a.swingT -= dt;
  const pos = a.mesh.position;

  // nearest zombie to fight (that's actually in the field and near the player)
  let target = null, bd = 16;
  for (const z of state.zombies) {
    if (z.dead) continue;
    if (Math.hypot(z.mesh.position.x, z.mesh.position.z) > PLAY_BOUND) continue;
    const d = z.mesh.position.distanceTo(pos);
    if (d < bd) { bd = d; target = z; }
  }
  // leash: squad members don't chain-chase across the whole map
  if (target && target.mesh.position.distanceTo(player.mesh.position) > 20) target = null;

  let moving = false;
  if (!target && state.boss) {
    // no zombie nearby? help fight the giant worm
    const bp = nearestBossPoint(pos.x, pos.z);
    if (bp.gap < 16) {
      const standoff = w.kind === 'ranged' ? 9 : 1.6;
      if (bp.gap > standoff) {
        const dir = tmpA.set(bp.x - pos.x, 0, bp.z - pos.z).normalize();
        pos.addScaledVector(dir, 4.2 * dt);
        moving = true;
      } else if (a.attackCd <= 0) {
        a.attackCd = w.kind === 'ranged' ? 0.7 : 1 / w.rate;
        a.swingT = 0.25;
        if (w.kind === 'ranged') {
          const dir = tmpA.set(bp.x - pos.x, 0, bp.z - pos.z).normalize();
          const bullet = M.makeBulletMesh(0x00e5ff);
          bullet.position.copy(pos).setY(1.1).addScaledVector(dir, 0.5);
          scene.add(bullet);
          state.projectiles.push({
            kind: 'friendly', mesh: bullet,
            vel: dir.clone().multiplyScalar(24),
            damage: Math.round(w.damage * ALLY_DAMAGE_MULT), life: 0.8, fromPlayer: false,
          });
          sfx.shoot();
        } else {
          damageBoss(Math.round(w.damage * ALLY_DAMAGE_MULT), { showNumber: false });
          sfx.hit();
        }
      }
      a.mesh.lookAt(bp.x, 0, bp.z);
      const swingB = Math.sin(a.walkT) * 0.55;
      a.parts.legL.rotation.x = swingB;
      a.parts.legR.rotation.x = -swingB;
      a.walkT = moving ? a.walkT + dt * 10 : 0;
      return;
    }
  }
  if (target) {
    const standoff = w.kind === 'ranged' ? 9 : 1.5 + target.radius;
    if (bd > standoff) {
      const dir = tmpA.subVectors(target.mesh.position, pos).setY(0).normalize();
      pos.addScaledVector(dir, 4.2 * dt);
      moving = true;
    } else if (a.attackCd <= 0) {
      a.attackCd = w.kind === 'ranged' ? 0.7 : 1 / w.rate;
      a.swingT = 0.25;
      if (w.kind === 'ranged') {
        const origin = pos.clone().setY(1.1);
        const dir = tmpA.subVectors(target.mesh.position, pos).setY(0).normalize();
        const bullet = M.makeBulletMesh(0x00e5ff);
        bullet.position.copy(origin).addScaledVector(dir, 0.5);
        scene.add(bullet);
        state.projectiles.push({
          kind: 'friendly', mesh: bullet,
          vel: dir.clone().multiplyScalar(24),
          damage: Math.round(w.damage * ALLY_DAMAGE_MULT), life: 0.8, fromPlayer: false,
        });
        sfx.shoot();
      } else {
        damageZombie(target, Math.round(w.damage * ALLY_DAMAGE_MULT), { showNumber: false });
        sfx.hit();
      }
    }
    a.mesh.lookAt(target.mesh.position.x, 0, target.mesh.position.z);
  } else {
    // follow the player in a loose diamond formation
    const angle = (i / Math.max(1, state.allies.length)) * Math.PI * 2;
    const spot = tmpB.set(
      player.mesh.position.x + Math.cos(angle) * 2.6,
      0,
      player.mesh.position.z + Math.sin(angle) * 2.6
    );
    const d = pos.distanceTo(spot);
    if (d > 1) {
      const dir = tmpA.subVectors(spot, pos).setY(0).normalize();
      pos.addScaledVector(dir, 4.2 * dt);
      a.mesh.lookAt(spot.x, 0, spot.z);
      moving = true;
    }
  }

  a.walkT = moving ? a.walkT + dt * 10 : 0;
  const swing = Math.sin(a.walkT) * 0.55;
  a.parts.legL.rotation.x = swing;
  a.parts.legR.rotation.x = -swing;
  a.parts.armL.rotation.x = -swing * 0.6;
  a.parts.armR.rotation.x = a.swingT > 0 ? -2.0 * Math.sin((a.swingT / 0.25) * Math.PI) : swing * 0.6;
}

/* ================= base upgrades & barbed wire ================= */

function applyBaseUpgrade(level) {
  const def = BASE_LEVELS[level];
  if (!def) return;
  state.baseLevel = level;
  state.baseMax = def.hp;
  state.baseHp = def.hp;   // upgrading fully repairs the base
  if (state.wireGroup) scene.remove(state.wireGroup);
  state.wireGroup = M.makeBarbedWire(def.wireRadius);
  scene.add(state.wireGroup);
  // nudge any turret sitting on the new fence line out of the way
  for (const t of state.turrets) {
    if (t.dead) continue;
    const d = Math.hypot(t.group.position.x, t.group.position.z);
    if (Math.abs(d - def.wireRadius) < 0.8) {
      const s = (def.wireRadius + 0.9) / d;
      t.group.position.x *= s;
      t.group.position.z *= s;
      spawnBurst(t.group.position.clone().setY(0.5), 0x8be98b, 6, 3, 0.1, 0.5);
    }
  }
  if (level === 3 || level === 4) baseMesh.add(M.makeBaseAddon(level));
  if (level === 4) baseMesh.scale.setScalar(1.08);
  if (level === 5) {
    scene.remove(baseMesh);
    baseMesh = M.makeCastle();
    scene.add(baseMesh);
    spawnBurst(tmpA.set(0, 2, 0), 0xffc107, 30, 7, 0.2, 1.1, 6, 4);
  }
  sfx.upgrade();
  showBanner(`🏗️ BASE UPGRADED!\n${level === 5 ? '🏰 ' : ''}${def.name}!`, 3);
  spawnBurst(tmpA.set(0, 1.5, 0), 0x8be98b, 16, 5, 0.14, 0.8);
  updateHud();
}

function updateWire(dt) {
  if (state.baseLevel < 2) return;
  const def = BASE_LEVELS[state.baseLevel];
  for (const z of state.zombies) {
    if (z.dead) continue;
    const d = Math.hypot(z.mesh.position.x, z.mesh.position.z);
    // hurts on the fence line AND anywhere inside it (base-attackers stand in the yard)
    if (d < def.wireRadius + 0.8) {
      z.hp -= def.wireDps * dt;
      z.hpBar.set(z.hp / z.maxHp);
      z.wireAcc = (z.wireAcc || 0) + dt;
      if (z.wireAcc > 0.4) {
        z.wireAcc = 0;
        spawnBurst(z.mesh.position.clone().setY(0.6), 0xef5350, 2, 2, 0.06, 0.3);
      }
      if (z.hp <= 0) killZombie(z);
    }
  }
}

/* ================= loot building ================= */

function spawnLootBuilding() {
  let pos = null;
  for (let tries = 0; tries < 30 && !pos; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = 15 + Math.random() * 13;
    const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const clear =
      state.cages.every((c) => c.mesh.position.distanceTo(p) > 6) &&
      state.turrets.every((t) => !t.dead && t.group.position.distanceTo(p) > 4 || t.dead);
    if (clear) pos = p;
  }
  if (!pos) return;
  const mesh = M.makeLootBuilding();
  mesh.position.copy(pos);
  mesh.rotation.y = Math.atan2(-pos.x, -pos.z) + Math.PI;   // door faces the base
  scene.add(mesh);
  state.lootBuilding = { mesh, looted: false };
}

function updateLoot() {
  const lb = state.lootBuilding;
  if (!lb || lb.looted || player.dead) return;
  if (lb.mesh.position.distanceTo(player.mesh.position) < 3.6) {
    lb.looted = true;
    const money = LOOT_BUILDING.money(state.wave);
    state.money += money;
    let roll = Math.random(), tier = 'common';
    for (const [t, p] of LOOT_BUILDING.turretChances) {
      if (roll < p) { tier = t; break; }
      roll -= p;
    }
    // never downgrade a saved voucher — keep the better one
    const held = state.freeTurretTier;
    let keptBetter = false;
    if (held && TURRET_ORDER.indexOf(held) >= TURRET_ORDER.indexOf(tier)) {
      tier = held;
      keptBetter = true;
    }
    state.freeTurretTier = tier;
    updateCurrencies();
    sfx.loot();
    const sign = lb.mesh.getObjectByName('sign');
    if (sign) sign.visible = false;
    spawnBurst(lb.mesh.position.clone().setY(1.5), 0xffd21f, 24, 5, 0.13, 0.9);
    floatText(lb.mesh.position.clone().setY(2.6), `💰 +$${money}`, '#8be98b', 0, 24);
    if (state.phase === 'build' && !state.placing && !state.shopOpen) {
      showBanner(`💰 LOOTED! +$${money}\n🎁 FREE ${TURRETS[tier].name}! Click to place it!`, 3.5);
      startFreePlacement(tier);
    } else {
      showBanner(
        `💰 LOOTED! +$${money}\n🎁 FREE ${TURRETS[tier].name}${keptBetter ? ' (kept your better one!)' : ''} saved!\nPlace it from the shop (B)!`,
        3.5
      );
    }
  }
}

// Free placements consume the voucher up front; cancelling gives it back
// (or cashes in the lesser one if a new voucher arrived mid-placement).
function startFreePlacement(tier) {
  startPlacement('turret', tier, null, { free: true });
  state.freeTurretTier = null;
}

/* ================= cages & rescued people ================= */

function spawnCages(n) {
  for (let i = 0; i < n && state.cages.length < 4; i++) {
    let pos = null;
    for (let tries = 0; tries < 30 && !pos; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 9 + Math.random() * 20;
      const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      const clear =
        state.cages.every((c) => c.mesh.position.distanceTo(p) > 6) &&
        state.turrets.every((t) => t.group.position.distanceTo(p) > 3) &&
        (!state.lootBuilding || state.lootBuilding.mesh.position.distanceTo(p) > 4);
      if (clear) pos = p;
    }
    if (!pos) continue;
    const cage = M.makeCageMesh();
    cage.position.copy(pos);
    scene.add(cage);
    const person = M.makePersonMesh();
    person.group.scale.setScalar(0.85);
    person.group.position.copy(pos);
    person.group.rotation.y = Math.random() * Math.PI * 2;
    scene.add(person.group);
    state.cages.push({ mesh: cage, person, dead: false });
  }
}

function rescueCage(c) {
  c.dead = true;
  state.stats.rescued++;
  sfx.rescue();
  const pos = c.mesh.position;

  const money = 15 + irand(10);
  state.money += money;
  floatText(pos.clone().setY(2.2), `+💵${money}`, '#8be98b', 0, 20);
  sfx.coin();
  let off = 26;
  if (Math.random() < 0.4) {
    const d = 1 + irand(1);
    state.diamonds += d;
    floatText(pos.clone().setY(2.2), `+💎${d}`, '#7fdcff', off, 20);
    off += 26;
    sfx.gem();
  }
  if (Math.random() < 0.25) {
    state.emeralds += 1;
    floatText(pos.clone().setY(2.2), `+<span class="em">♦</span>1`, '#1ddb6e', off, 20);
    sfx.gem();
  }
  updateCurrencies();
  spawnBurst(pos.clone().setY(1.2), 0xffe14f, 16, 4, 0.1, 0.8);
  scene.remove(c.mesh);

  if (state.allies.length < ALLY_CAP) {
    // they grab a weapon and fight for you!
    recruitAlly(c.person);
  } else {
    // squad is full — this one runs home to safety
    state.people.push({ mesh: c.person.group, parts: c.person.parts, walkT: 0, dead: false });
    floatText(pos.clone().setY(3), '🎉 RESCUED!', '#ffe14f', 52, 22);
  }
}

function updateCages() {
  for (const c of state.cages) {
    if (c.dead || player.dead) continue;
    if (c.mesh.position.distanceTo(player.mesh.position) < 2.3) rescueCage(c);
  }
  state.cages = state.cages.filter((c) => !c.dead);
}

function updatePeople(dt) {
  for (const p of state.people) {
    const pos = p.mesh.position;
    const d = Math.hypot(pos.x, pos.z);
    if (d < 4.6) {
      p.dead = true;
      spawnBurst(pos.clone().setY(1.2), 0xffe14f, 8, 2.5, 0.09, 0.5);
      scene.remove(p.mesh);
      continue;
    }
    const dir = tmpA.set(-pos.x / d, 0, -pos.z / d);
    pos.addScaledVector(dir, 3.4 * dt);
    p.mesh.lookAt(0, 0, 0);
    p.walkT += dt * 11;
    const swing = Math.sin(p.walkT) * 0.6;
    p.parts.legL.rotation.x = swing;
    p.parts.legR.rotation.x = -swing;
    p.parts.armL.rotation.x = -swing;
    p.parts.armR.rotation.x = swing;
  }
  state.people = state.people.filter((p) => !p.dead);
}

/* ================= base ================= */

function damageBase(dmg) {
  if (state.over) return;
  state.baseHp -= dmg;
  sfx.baseHit();
  spawnBurst(tmpA.set((Math.random() - 0.5) * 3, 1.5, (Math.random() - 0.5) * 3), 0xb0402f, 6, 3, 0.1, 0.5);
  if (state.baseHp <= 0) {
    state.baseHp = 0;
    gameOver();
  }
  $('base-fill').style.width = `${(state.baseHp / state.baseMax) * 100}%`;
}

/* ================= waves ================= */

function startBuildPhase() {
  state.phase = 'build';
  state.buildLeft = state.wave === 0 ? 25 : 16;
  $('btn-wave').classList.remove('hidden');
}

function startWave() {
  state.wave++;
  state.phase = 'wave';
  state.spawnQueue = waveComposition(state.wave);
  state.spawnTimer = 0.5;
  $('btn-wave').classList.add('hidden');
  sfx.waveStart();

  if (state.wave >= DESERT_START_WAVE && !state.desert) switchToDesert();
  const bossWave = state.wave >= DESERT_START_WAVE && (state.wave - DESERT_START_WAVE) % BOSS_EVERY === 0;

  if (state.wave === DESERT_START_WAVE) {
    showBanner(`🏜️ WELCOME TO THE DESERT! 🏜️\nNEW ZOMBIE: 🌪️ Dust Zombie!\n🪱 BOSS: INFECTED SAND WORM!\n🔨 Tip: the Repair Hammer fixes turrets!`, 6.5);
    if (!state.ownedWeapons.hammer) {
      $('tip').innerHTML = '🔨 Tip: Buy the <b>Repair Hammer</b> in the shop — it fixes your turrets!';
    }
  } else if (bossWave) {
    showBanner(`🌊 WAVE ${state.wave} 🌊\n🪱 THE SAND WORM RETURNS!`, 3.5);
  } else {
    const newType = ZOMBIE_ORDER.find((t) => ZOMBIE_UNLOCK_WAVE[t] === state.wave);
    if (newType) {
      const d = ZOMBIES[newType];
      showBanner(`🌊 WAVE ${state.wave} 🌊\nNEW ZOMBIE: ${d.emoji} ${d.name}!\n${d.desc}`, 4);
    } else {
      showBanner(`🌊 WAVE ${state.wave} 🌊`, 2.2);
    }
  }
  if (bossWave) spawnBoss();

  // loot buildings: clear a looted one, spawn a fresh one on odd waves
  if (state.lootBuilding && state.lootBuilding.looted) {
    scene.remove(state.lootBuilding.mesh);
    state.lootBuilding = null;
  }
  if (!state.lootBuilding && state.wave >= LOOT_BUILDING.minWave &&
      (state.wave - LOOT_BUILDING.minWave) % LOOT_BUILDING.everyNWaves === 0) {
    spawnLootBuilding();
  }

  spawnCages(2 + (state.wave >= 4 ? 1 : 0));
}

function endWave() {
  // leftover sandstorms blow away — build time is safe time
  for (const st of state.storms) {
    st.dead = true;
    spawnBurst(st.mesh.position.clone().setY(1), 0xd8b06a, 6, 3, 0.12, 0.6);
    scene.remove(st.mesh);
  }
  state.storms = [];
  const r = waveReward(state.wave);
  state.money += r.money;
  state.diamonds += r.diamonds;
  state.emeralds += r.emeralds;
  updateCurrencies();
  sfx.waveDone();
  let txt = `✅ WAVE ${state.wave} CLEARED!\n+💵${r.money}  +💎${r.diamonds}`;
  if (r.emeralds) txt += `  +♦${r.emeralds} emerald`;
  showBanner(txt, 3.2);
  startBuildPhase();
}

function updatePhase(dt) {
  if (state.phase === 'build') {
    state.buildLeft -= dt;
    setText('wave-label', `🛠️ Build time! Wave ${state.wave + 1} in ${Math.ceil(state.buildLeft)}s`);
    setText('zombies-left', 'Buy turrets and get ready!');
    if (state.buildLeft <= 0) startWave();
  } else {
    state.spawnTimer -= dt;
    if (state.spawnQueue.length && state.spawnTimer <= 0 && state.zombies.length < MAX_ZOMBIES_ALIVE) {
      spawnZombie(state.spawnQueue.shift());
      state.spawnTimer = Math.max(0.45, 1.5 - state.wave * 0.06);
    }
    const left = state.spawnQueue.length + state.zombies.length;
    setText('wave-label', `🌊 Wave ${state.wave}${state.desert ? ' 🏜️' : ''}`);
    setText('zombies-left', state.boss
      ? `🪱 BOSS + ${left} zombies left`
      : `🧟 ${left} zombies left`);
    if (left === 0 && !state.boss) endWave();
  }
}

/* ================= shop ================= */

function card(html) {
  const div = document.createElement('div');
  div.className = 'item-card';
  div.innerHTML = html;
  return div;
}

function buyButton(cost, onBuy, { disabled = false, label = null } = {}) {
  const btn = document.createElement('button');
  btn.className = 'buy-btn';
  if (label) {
    btn.textContent = label;
    btn.disabled = true;
    btn.classList.add('owned');
  } else {
    btn.innerHTML = `Buy — ${costText(cost)}`;
    btn.disabled = disabled || !canAfford(cost);
    btn.onclick = () => { if (canAfford(cost)) { pay(cost); sfx.buy(); onBuy(); } };
  }
  return btn;
}

function renderShop() {
  shopItems.innerHTML = '';
  const tab = state.shopTab;

  if (tab === 'turrets') {
    for (const tier of TURRET_ORDER) {
      const d = TURRETS[tier];
      const descLine = d.special
        ? d.special
        : (state.costumes[tier] && COSTUMES[tier] ? `Wearing the ${COSTUMES[tier].name}! (+10% dmg)` : '');
      const el = card(`
        <h4>${d.emoji} ${d.name}</h4>
        <div class="stats">⚔️ ${d.damage} dmg &nbsp; 🎯 ${d.range} range<br>⏱️ ${d.fireRate}/s &nbsp; ❤️ ${d.hp} HP</div>
        <div class="desc">${descLine}</div>`);
      if (state.freeTurretTier === tier) {
        const freeBtn = document.createElement('button');
        freeBtn.className = 'buy-btn';
        freeBtn.textContent = '🎁 Place your FREE one!';
        freeBtn.onclick = () => {
          closeShop();
          startFreePlacement(tier);
        };
        el.appendChild(freeBtn);
      }
      el.appendChild(buyButton(d.cost, () => {
        closeShop();
        startPlacement('turret', tier, d.cost);
      }));
      shopItems.appendChild(el);
    }
  } else if (tab === 'costumes') {
    for (const tier of TURRET_ORDER) {
      const c = COSTUMES[tier];
      if (!c) continue;   // the dust turret has no costume (yet!)
      const owned = !!state.costumes[tier];
      const el = card(`
        <h4>${c.emoji} ${c.name}</h4>
        <div class="stats">For the ${TURRETS[tier].name} ${TURRETS[tier].emoji}</div>
        <div class="desc">Dresses up ALL your ${tier} turrets and gives them +10% damage!</div>`);
      el.appendChild(buyButton(c.cost, () => buyCostume(tier), owned ? { label: 'Owned ✔' } : {}));
      shopItems.appendChild(el);
    }
  } else if (tab === 'weapons') {
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      const owned = !!state.ownedWeapons[id];
      const el = card(`
        <h4>${w.emoji} ${w.name}</h4>
        <div class="stats">${w.kind === 'repair'
          ? `💚 +${w.heal} turret HP &nbsp; ⏱️ ${w.rate} hits/s<br>🔧 Repairs turrets!`
          : `⚔️ ${w.damage} dmg &nbsp; ⏱️ ${w.rate} hits/s<br>${w.kind === 'melee' ? '🤜 Melee' : '🎯 Shoots!'}`}</div>
        ${w.special ? `<div class="desc">${w.special}</div>` : ''}`);
      el.appendChild(buyButton(w.cost, () => {
        state.ownedWeapons[id] = true;
        selectWeapon(id);
        renderShop();
      }, owned ? { label: 'Owned ✔' } : {}));
      shopItems.appendChild(el);
    }
  } else if (tab === 'base') {
    // --- base upgrade ---
    const next = state.baseLevel + 1;
    const bdef = BASE_LEVELS[next];
    if (bdef) {
      const el = card(`
        <h4>${next === 5 ? '🏰' : '🏗️'} Level ${next}: ${bdef.name}</h4>
        <div class="stats">❤️ Base HP → ${bdef.hp} &nbsp; 🧷 Wire: ${bdef.wireDps} dmg/s</div>
        <div class="desc">${bdef.desc}</div>`);
      el.appendChild(buyButton(bdef.cost, () => {
        applyBaseUpgrade(next);
        renderShop();
      }));
      shopItems.appendChild(el);
    } else {
      shopItems.appendChild(card(`
        <h4>🏰 Castle Complete!</h4>
        <div class="desc">Your base is MAX LEVEL. The zombies never stood a chance.</div>`));
    }
    // --- helper robot ---
    if (!state.robot) {
      const el = card(`
        <h4>${ROBOT.emoji} ${ROBOT.name}</h4>
        <div class="desc">A friendly robot that follows you around. Give it a Repair Hammer to fix turrets, or a Bat/Crowbar to fight zombies!</div>`);
      el.appendChild(buyButton(ROBOT.cost, () => {
        buyRobot();
        renderShop();
      }));
      shopItems.appendChild(el);
    } else {
      for (const toolId of Object.keys(ROBOT.tools)) {
        const w = WEAPONS[toolId];
        const owned = !!state.ownedWeapons[toolId];
        const equipped = state.robot.tool === toolId;
        const el = card(`
          <h4>${ROBOT.emoji} Give ${w.emoji} ${w.name}</h4>
          <div class="desc">${toolId === 'hammer'
            ? 'The robot will zoom around repairing your turrets!'
            : 'The robot will bonk zombies with it!'}</div>`);
        const btn = document.createElement('button');
        btn.className = 'buy-btn';
        if (equipped) {
          btn.textContent = 'Equipped ✔';
          btn.disabled = true;
          btn.classList.add('owned');
        } else if (!owned) {
          btn.textContent = `Buy the ${w.name} first`;
          btn.disabled = true;
        } else {
          btn.textContent = `Hand it over!`;
          btn.onclick = () => { giveRobotTool(toolId); renderShop(); };
        }
        el.appendChild(btn);
        shopItems.appendChild(el);
      }
    }
  } else if (tab === 'items') {
    for (const id of ITEM_ORDER) {
      const it = ITEMS[id];
      const el = card(`
        <h4>${it.emoji} ${it.name}</h4>
        <div class="desc">${it.desc}</div>`);
      if (id === 'trap') {
        el.appendChild(buyButton(it.cost, () => {
          closeShop();
          startPlacement('trap', id, it.cost);
        }));
      } else {
        el.appendChild(buyButton(it.cost, () => {
          player.hp = Math.min(player.max, player.hp + it.heal);
          sfx.heal();
          floatText(player.mesh.position.clone().setY(2.2), `${it.emoji} +HP!`, '#8be98b');
          updateHud();
          renderShop();
        }, player.dead ? { label: 'You are knocked out!' }
          : player.hp >= player.max ? { label: 'HP already full' } : {}));
      }
      shopItems.appendChild(el);
    }
  }
}

function buyCostume(tier) {
  state.costumes[tier] = true;
  lsSet('bradyZombieCostumes', JSON.stringify(state.costumes));
  for (const t of state.turrets) {
    if (t.dead || t.tier !== tier) continue;
    t.hatSlot.add(M.makeCostumeHat(COSTUMES[tier].style));
    t.dmgMult = 1 + COSTUME_DAMAGE_BONUS;
    spawnBurst(t.group.position.clone().setY(1.8), 0xffe14f, 10, 3, 0.09, 0.6);
  }
  renderShop();
}

function openShop() {
  state.shopOpen = true;
  shopEl.classList.remove('hidden');
  updateCurrencies();
  renderShop();
}
function closeShop() {
  state.shopOpen = false;
  shopEl.classList.add('hidden');
}

/* ================= placement ================= */

function startPlacement(kind, id, cost, opts = {}) {
  cancelPlacement();
  const mesh = kind === 'turret' ? M.makeTurretMesh(TURRETS[id]).group : M.makeTrapMesh();
  mesh.traverse((o) => { if (o.isMesh) o.material = M.ghostGreen; });
  scene.add(mesh);
  let ring = null;
  if (kind === 'turret') {
    ring = new THREE.Mesh(
      new THREE.RingGeometry(TURRETS[id].range - 0.15, TURRETS[id].range, 48),
      new THREE.MeshBasicMaterial({ color: 0x44ff44, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    scene.add(ring);
  }
  state.placing = { kind, id, cost, mesh, ring, valid: false, free: !!opts.free };
  $('tip').textContent = opts.free
    ? '🎁 Click to place your FREE turret! (Esc keeps it for later)'
    : '🖱️ Click to place! Right-click or Esc to cancel (refund).';
}

function updatePlacement() {
  const pl = state.placing;
  if (!pl || !aimValid) return;
  const p = tmpA.copy(aimPoint);
  const len = Math.hypot(p.x, p.z);
  if (len > PLAY_BOUND - 1) { p.x *= (PLAY_BOUND - 1) / len; p.z *= (PLAY_BOUND - 1) / len; }
  pl.mesh.position.set(p.x, 0, p.z);
  if (pl.ring) pl.ring.position.set(p.x, 0.05, p.z);

  const nearBase = Math.hypot(p.x, p.z) < 5.5;
  const nearTurret = state.turrets.some((t) => !t.dead && t.group.position.distanceTo(pl.mesh.position) < 2.2);
  const nearCage = state.cages.some((c) => c.mesh.position.distanceTo(pl.mesh.position) < 2.2);
  const nearLoot = state.lootBuilding && state.lootBuilding.mesh.position.distanceTo(pl.mesh.position) < 3.4;
  const wireDef = state.baseLevel >= 2 ? BASE_LEVELS[state.baseLevel] : null;
  const onWire = !!wireDef && Math.abs(Math.hypot(pl.mesh.position.x, pl.mesh.position.z) - wireDef.wireRadius) < 0.8;
  pl.valid = !nearBase && !nearTurret && !nearCage && !nearLoot && !onWire;
  const m = pl.valid ? M.ghostGreen : M.ghostRed;
  pl.mesh.traverse((o) => { if (o.isMesh) o.material = m; });
}

function confirmPlacement() {
  const pl = state.placing;
  if (!pl || !pl.valid) return;
  if (pl.kind === 'turret') placeTurret(pl.id, pl.mesh.position.clone(), { free: pl.free });
  else placeTrap(pl.mesh.position.clone());
  clearPlacementVisuals();
  state.placing = null;
  $('tip').innerHTML = '🧍 Walk up to caged people to rescue them for 💵 💎 <span class="em">♦</span>!';
}

function cancelPlacement() {
  const pl = state.placing;
  if (!pl) return;
  refund(pl.cost);
  if (pl.free) {
    if (!state.freeTurretTier) {
      state.freeTurretTier = pl.id;
    } else {
      // a second voucher arrived mid-placement — keep the better, cash in the other
      if (TURRET_ORDER.indexOf(pl.id) > TURRET_ORDER.indexOf(state.freeTurretTier)) {
        state.freeTurretTier = pl.id;
      }
      state.money += 100;
      updateCurrencies();
      floatText(player.mesh.position.clone().setY(2.4), '+💵100 spare voucher cash-in!', '#8be98b');
    }
  }
  clearPlacementVisuals();
  state.placing = null;
  $('tip').innerHTML = pl.free
    ? '🎁 Your free turret is saved — grab it in the shop (Turrets tab)!'
    : '🧍 Walk up to caged people to rescue them for 💵 💎 <span class="em">♦</span>!';
}

function clearPlacementVisuals() {
  const pl = state.placing;
  if (!pl) return;
  scene.remove(pl.mesh);
  if (pl.ring) { scene.remove(pl.ring); pl.ring.geometry.dispose(); pl.ring.material.dispose(); }
}

/* ================= input ================= */

const keys = { up: false, down: false, left: false, right: false };
const input = { attacking: false };
const mouseNDC = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimPoint = new THREE.Vector3();
let aimValid = false;

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.up = true;
  if (k === 's' || k === 'arrowdown') keys.down = true;
  if (k === 'a' || k === 'arrowleft') keys.left = true;
  if (k === 'd' || k === 'arrowright') keys.right = true;
  if (k === 'b' && state.running && !state.over) state.shopOpen ? closeShop() : openShop();
  if (k === 'n' && state.running && state.phase === 'build' && !state.shopOpen) startWave();
  if (k === 'escape') {
    if (state.shopOpen) closeShop();
    else if (state.placing) cancelPlacement();
  }
  const num = parseInt(k, 10);
  if (num >= 1 && num <= WEAPON_ORDER.length) selectWeapon(WEAPON_ORDER[num - 1]);
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.up = false;
  if (k === 's' || k === 'arrowdown') keys.down = false;
  if (k === 'a' || k === 'arrowleft') keys.left = false;
  if (k === 'd' || k === 'arrowright') keys.right = false;
});

window.addEventListener('mousemove', (e) => {
  mouseNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
});
renderer.domElement.addEventListener('mousedown', (e) => {
  initAudio();
  if (!state.running || state.over || state.shopOpen) return;
  if (state.placing) {
    if (e.button === 0) confirmPlacement();
    else cancelPlacement();
    return;
  }
  if (e.button === 0) input.attacking = true;
});
window.addEventListener('mouseup', () => { input.attacking = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());

// Don't leave keys/attack stuck if the window loses focus mid-press.
function resetTransientInput() {
  keys.up = keys.down = keys.left = keys.right = false;
  input.attacking = false;
}
window.addEventListener('blur', resetTransientInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetTransientInput(); });

// Blur buttons after click so Space/Enter doesn't re-trigger them mid-game.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn) btn.blur();
});

$('btn-shop').onclick = () => { initAudio(); if (state.running && !state.over) (state.shopOpen ? closeShop() : openShop()); };
$('btn-wave').onclick = () => { if (state.phase === 'build') startWave(); };
$('shop-close').onclick = closeShop;
$('btn-mute').onclick = () => { $('btn-mute').textContent = toggleMute() ? '🔇' : '🔊'; };
document.querySelectorAll('#shop-tabs .tab').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('#shop-tabs .tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.shopTab = btn.dataset.tab;
    renderShop();
  };
});

/* ================= game flow ================= */

function fillCodex() {
  const codex = $('codex');
  for (const type of ZOMBIE_ORDER) {
    const d = ZOMBIES[type];
    const li = document.createElement('li');
    li.innerHTML = `${d.emoji} <b>${d.name}</b> — ${d.desc}`;
    codex.appendChild(li);
  }
}

function startGame() {
  initAudio();
  $('start-screen').classList.add('hidden');
  hud.classList.remove('hidden');
  state.running = true;
  updateCurrencies();
  renderHotbar();
  $('base-fill').style.width = '100%';
  $('player-fill').style.width = '100%';
  startBuildPhase();
  spawnCages(2);
  showBanner('🛒 Buy a turret and get ready!\nRescue caged people for 💵💎!', 4);
}

function gameOver() {
  state.over = true;
  if (state.boss) {
    scene.remove(state.boss.group);
    state.boss = null;
  }
  $('boss-wrap').classList.add('hidden');
  sfx.gameOver();
  const high = Math.max(state.wave, parseInt(lsGet('bradyZombieHighWave', '0'), 10) || 0);
  lsSet('bradyZombieHighWave', String(high));
  $('go-stats').innerHTML =
    `🌊 You survived <b>${state.wave}</b> wave${state.wave === 1 ? '' : 's'}<br>` +
    `🧟 Zombies defeated: <b>${state.stats.kills}</b><br>` +
    `🎉 People rescued: <b>${state.stats.rescued}</b><br>` +
    `🏆 Best ever: wave <b>${high}</b><br>` +
    `💎 Your <b>${state.diamonds}</b> diamonds and costumes are saved for next time!`;
  $('gameover').classList.remove('hidden');
}

$('btn-play').onclick = startGame;
$('btn-again').onclick = () => location.reload();

/* ================= HUD ================= */

// DOM writes are not free — only touch the DOM when the value actually changed.
const lastText = {};
function setText(id, text) {
  if (lastText[id] === text) return;
  lastText[id] = text;
  $(id).textContent = text;
}
const lastWidth = {};
function setWidth(id, pct) {
  const v = `${Math.round(Math.max(0, Math.min(100, pct)) * 2) / 2}%`;
  if (lastWidth[id] === v) return;
  lastWidth[id] = v;
  $(id).style.width = v;
}

function updateHud() {
  setWidth('player-fill', (player.hp / player.max) * 100);
  setWidth('base-fill', (state.baseHp / state.baseMax) * 100);
}

/* ================= camera & loop ================= */

const camTarget = new THREE.Vector3(0, 0, 7);

function updateCamera(dt) {
  const p = player.mesh ? player.mesh.position : camTarget;
  camTarget.lerp(p, 1 - Math.exp(-4 * dt));
  camera.position.set(camTarget.x, 21, camTarget.z + 14.5);
  camera.lookAt(camTarget.x, 0, camTarget.z - 1.5);
  // earthquake!
  if (state.shakeT > 0) {
    state.shakeT -= dt;
    const s = state.shakeT * 0.55;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s * 0.7;
    camera.position.z += (Math.random() - 0.5) * s;
  }
}

const clock = new THREE.Clock();

function sim(dt) {
  // aim raycast
  raycaster.setFromCamera(mouseNDC, camera);
  aimValid = raycaster.ray.intersectPlane(groundPlane, aimPoint) !== null;

  if (state.running && !state.shopOpen && !state.over) {
    state.time += dt;
    updatePhase(dt);
    updatePlayer(dt);
    for (const z of state.zombies) updateZombie(z, dt);
    for (const t of state.turrets) updateTurret(t, dt);
    for (const pr of state.projectiles) updateProjectile(pr, dt);
    for (const tr of state.traps) updateTrap(tr, dt);
    for (const st of state.storms) updateStorm(st, dt);
    updateBoss(dt);
    updateRobot(dt);
    state.allies.forEach((a, i) => updateAlly(a, i, dt));
    updateWire(dt);
    updateLoot();
    updateCages();
    updatePeople(dt);
    updateParticles(dt);
    updatePlacement();

    state.zombies = state.zombies.filter((z) => !z.dead);
    state.turrets = state.turrets.filter((t) => !t.dead);
    state.projectiles = state.projectiles.filter((p) => !p.dead);
    state.traps = state.traps.filter((t) => !t.dead);
    state.storms = state.storms.filter((s) => !s.dead);

    updateHud();
  }
}

function tick(dt) {
  sim(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
  syncFrameIfSoftware();
}

let lastFrameAt = performance.now();
let perfPaused = false;        // panic brake engaged — nothing runs until the user clicks
let renderAccumulator = 0;
let skipGapOnce = true;        // the first frame (and the first after un-hiding) has a meaningless gap

document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetTransientInput();
  else { skipGapOnce = true; renderAccumulator = 0; }
});

function animate(ts) {
  requestAnimationFrame(animate);
  const nowMs = typeof ts === 'number' ? ts : performance.now();
  const gap = nowMs - lastFrameAt;
  lastFrameAt = nowMs;
  // Visible gaps are NEVER filtered by size — a 3-second frame with the tab visible is
  // exactly the catastrophe the brake exists for. Only a just-un-hidden tab is ignored.
  const gapSample = document.visibilityState === 'visible' && !skipGapOnce ? gap : null;
  skipGapOnce = false;
  if (perfPaused) return;

  const dt = Math.min(0.05, clock.getDelta());

  // Simulation + camera run every frame so play feels identical at any render rate.
  sim(dt);
  updateCamera(dt);

  // Menus, the shop and the game-over screen don't need 60fps: draw them gently.
  const idle = !state.running || state.over || state.shopOpen;
  const limit = rateLimit(renderAccumulator, gap, idle ? 15 : fpsCap);
  renderAccumulator = limit.acc;
  if (!limit.render) return;

  const t0 = performance.now();
  renderer.render(scene, camera);
  syncFrameIfSoftware();
  const work = performance.now() - t0;

  if (nowMs < graceUntil) return;   // settling after a tier change / resume
  const verdict = governor.sample(work, gapSample, nowMs);
  if (verdict.panic) {
    lsSet('bradyZombieQuality', '');          // a panic always returns graphics to Auto
    applyQuality(verdict.tier);
    engagePanicBrake(verdict);
  } else if (verdict.changed) {
    applyQuality(verdict.tier);
  }
}

// Panic brake: if frames get catastrophically slow, STOP everything and let the
// machine breathe. The player clicks to continue on the lowered setting.
function engagePanicBrake(verdict) {
  perfPaused = true;
  resetTransientInput();
  const tierName = verdict.tier.toUpperCase();
  $('perf-msg').innerHTML = verdict.changed
    ? `Your computer was struggling to keep up, so the game paused itself and switched graphics to <b>${tierName}</b>.`
    : `Your computer is struggling even on the lowest graphics setting (<b>${tierName}</b>), so the game paused to let it recover.`;
  $('perf-overlay').classList.remove('hidden');
}
$('perf-resume').onclick = () => {
  perfPaused = false;
  $('perf-overlay').classList.add('hidden');
  clock.getDelta();                 // drop the time we spent paused
  lastFrameAt = performance.now();
  renderAccumulator = 0;
  skipGapOnce = true;
  graceUntil = performance.now() + 1500;
};

// Graphics button: Auto -> High -> Medium -> Low -> Potato -> Auto
$('btn-gfx').onclick = () => {
  if (!governor.locked) {
    governor.setTier('high', true);
  } else {
    const i = TIERS.indexOf(governor.tier);
    if (i >= TIERS.length - 1) governor.setTier(softwareGpu ? 'potato' : 'high', false);
    else governor.setTier(TIERS[i + 1], true);
  }
  lsSet('bradyZombieQuality', governor.locked ? governor.tier : '');
  applyQuality(governor.tier);
};

// Keep the game simulating (never rendering) when the tab is hidden and rAF is throttled.
setInterval(() => {
  if (document.hidden && !perfPaused && performance.now() - lastFrameAt > 400) {
    clock.getDelta();
    sim(1 / 30);
  }
}, 250);

fillCodex();
initPlayer();
updateCurrencies();
animate();

// Debug/testing handle — lets automated tests drive the simulation.
window.__game = {
  state, player, tick, sim,
  ff: (secs) => { const n = Math.ceil(secs * 30); for (let i = 0; i < n; i++) sim(1 / 30); },
  spawnZombie, placeTurret, placeTrap, startWave, buyCostume,
  damageZombie, damageTurret, strongestTurret, nearestTurret,
  spawnBoss, damageBoss, spawnSandstorm, switchToDesert,
  buyRobot, giveRobotTool, applyBaseUpgrade, spawnLootBuilding, recruitAlly,
  selectWeapon, keys, input, camera, aimPoint,
  THREEV: new THREE.Vector3(),
  vec: (x, y, z) => new THREE.Vector3(x, y, z),
  // perf introspection / screenshot (render + read back in the same task, no preserveDrawingBuffer needed)
  snapshot: (q = 0.85) => { tick(0); return renderer.domElement.toDataURL('image/jpeg', q); },
  perf: () => ({
    gpu: gpuName, softwareGpu, tier: governor.tier, locked: governor.locked,
    emaMs: +governor.ema.toFixed(1), pixelRatio: renderer.getPixelRatio(),
    canvas: [renderer.domElement.width, renderer.domElement.height],
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    shadows: renderer.shadowMap.enabled, particles: state.particles.length, zombies: state.zombies.length,
  }),
  governor, applyQuality,
};
