// Drive js/main.js under Node with the DOM + renderer stubs. Usage: node run.mjs <hw|sw|nogl|saved|noext>
import { runFrame, dispatch, getElementById, unknownIds, advance } from './dom-stub.mjs';

const mode = process.argv[2] || 'hw';
const rendererStrings = {
  hw: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  sw: 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
  noext: 'WebKit WebGL',
};
if (mode === 'nogl') {
  globalThis.__fakeGL = null;
} else {
  const withExt = mode !== 'noext';
  globalThis.__fakeGL = {
    RENDERER: 0x1F01,
    getExtension(name) {
      if (name === 'WEBGL_debug_renderer_info' && withExt) return { UNMASKED_RENDERER_WEBGL: 0x9246 };
      if (name === 'WEBGL_lose_context') return { loseContext() { globalThis.__lost = true; } };
      return null;
    },
    getParameter(p) { return p === 0x9246 ? rendererStrings[mode] || rendererStrings.hw : rendererStrings.noext; },
  };
}
if (mode === 'saved') localStorage.setItem('bradyZombieQuality', 'low');

const log = (...a) => console.log('[' + mode + ']', ...a);
let failures = 0;
function step(name, fn) {
  try { fn(); log('ok  ', name); }
  catch (e) { failures++; log('FAIL', name, '\n      ', e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n       ') : e); }
}

let main;
try {
  main = await import('./js/main.js');
} catch (e) {
  console.log('[' + mode + '] STARTUP EXCEPTION:', e && e.stack ? e.stack : e);
  process.exit(2);
}
const g = globalThis.__game;
log('startup OK. gpu=', JSON.stringify(g.perf()));
log('renderer params:', JSON.stringify(globalThis.__rendererParams));
log('unknown DOM ids requested:', JSON.stringify([...new Set(unknownIds)]));
log('btn-gfx label:', JSON.stringify(getElementById('btn-gfx').textContent), ' gfx-note:', JSON.stringify(getElementById('gfx-note').textContent));
log('perf-overlay hidden at start:', getElementById('perf-overlay').classList.contains('hidden'));

const renderer = (() => { // reach the renderer through the canvas owner: perf() exposes canvas dims only, so track via renderLog on the stub
  return globalThis.__rendererInstance;
})();

// ---------- idle menu frames ----------
step('120 idle frames at 60Hz (start screen)', () => {
  for (let i = 0; i < 120; i++) runFrame(16.667);
  const p = g.perf();
  log('   after idle: tier', p.tier, 'ema', p.emaMs, 'pixelRatio', p.pixelRatio, 'canvas', p.canvas, 'shadows', p.shadows);
});

// ---------- start game via button ----------
step('click PLAY', () => { getElementById('btn-play').onclick(); if (!g.state.running) throw new Error('not running'); });
step('60 running frames', () => { for (let i = 0; i < 60; i++) runFrame(16.667); });

// ---------- populate the world ----------
step('place turrets of every tier + costumes', () => {
  const { TURRET_ORDER } = main; // not exported; fallback below
});
let TURRET_ORDER, ZOMBIE_ORDER, WEAPON_ORDER;
step('load config', async () => {});
const cfg = await import('./js/config.js');
TURRET_ORDER = cfg.TURRET_ORDER; ZOMBIE_ORDER = cfg.ZOMBIE_ORDER; WEAPON_ORDER = cfg.WEAPON_ORDER;

step('place one turret per tier', () => {
  TURRET_ORDER.forEach((tier, i) => {
    const a = (i / TURRET_ORDER.length) * Math.PI * 2;
    g.placeTurret(tier, g.vec(Math.cos(a) * 8, 0, Math.sin(a) * 8));
  });
  g.placeTrap(g.vec(3, 0, 3));
});
step('buy all costumes', () => { for (const tier of TURRET_ORDER) g.buyCostume(tier); });
step('spawn 5 of every zombie type (cap 60)', () => {
  for (const type of ZOMBIE_ORDER) for (let i = 0; i < 5; i++) g.spawnZombie(type);
  log('   zombies alive:', g.state.zombies.length);
});
step('own all weapons + robot + ally + base upgrades', () => {
  for (const id of WEAPON_ORDER) g.state.ownedWeapons[id] = true;
  g.selectWeapon('gun');
  g.buyRobot(); g.giveRobotTool('hammer');
  g.applyBaseUpgrade(2); g.applyBaseUpgrade(3); g.applyBaseUpgrade(4); g.applyBaseUpgrade(5);
  g.spawnLootBuilding();
});
step('start wave + fast-forward 40s of sim', () => { g.startWave(); g.ff(40); log('   zombies', g.state.zombies.length, 'particles', g.state.particles.length, 'turrets', g.state.turrets.length); });
step('player attacks with mouse (melee, gun, hammer)', () => {
  for (const w of ['bat', 'gun', 'hammer', 'suit', 'crowbar', 'fists']) {
    g.selectWeapon(w);
    dispatch('canvas', 'mousedown', { button: 0 });
    for (let i = 0; i < 30; i++) runFrame(16.667);
    dispatch('window', 'mouseup', {});
  }
});
step('keyboard: move, shop toggle, escape, weapon keys', () => {
  for (const k of ['w', 'a', 's', 'd', 'ArrowUp', '1', '2', '3', '4', '5', '6', 'n']) dispatch('window', 'keydown', { key: k, repeat: false });
  for (let i = 0; i < 30; i++) runFrame(16.667);
  for (const k of ['w', 'a', 's', 'd', 'ArrowUp']) dispatch('window', 'keyup', { key: k });
  dispatch('window', 'keydown', { key: 'b', repeat: false });
  for (let i = 0; i < 30; i++) runFrame(16.667);   // shop open: idle 15fps path
  dispatch('window', 'keydown', { key: 'Escape', repeat: false });
  if (g.state.shopOpen) throw new Error('shop still open');
});
step('shop render for all tabs', () => {
  getElementById('btn-shop').onclick();
  for (const b of document.querySelectorAll('#shop-tabs .tab')) b.onclick();
  getElementById('shop-close').onclick();
});
step('placement flow: start, move, confirm', () => {
  g.state.money = 99999;
  getElementById('btn-shop').onclick();
  document.querySelectorAll('#shop-tabs .tab')[0].onclick();
  // first tab is turrets; find a buy button via shop-items children
  const items = getElementById('shop-items').children;
  const btn = items[0].children.find((c) => c.tagName === 'BUTTON' && c.onclick);
  btn.onclick();
  if (!g.state.placing) throw new Error('not placing');
  g.aimPoint.set(12, 0, 12);
  for (let i = 0; i < 5; i++) runFrame(16.667);
  dispatch('canvas', 'mousedown', { button: 0 });
  if (g.state.placing) { dispatch('canvas', 'mousedown', { button: 2 }); }
  if (g.state.shopOpen) getElementById('shop-close').onclick();
});
// render-rate checks
step('fps cap: idle 15fps, running high 60, potato 24', () => {
  const R = globalThis.__rendererInstance;
  const countRenders = (n, ms) => { const c0 = R.renderCount; for (let i = 0; i < n; i++) runFrame(ms); return R.renderCount - c0; };
  g.applyQuality('high');
  const runHigh = countRenders(600, 16.667);
  g.applyQuality('potato');
  const runPotato = countRenders(600, 16.667);
  getElementById('btn-shop').onclick();
  const idle = countRenders(600, 16.667);
  getElementById('shop-close').onclick();
  log('   renders per 10s: running-high', runHigh, 'running-potato', runPotato, 'shop-open(idle)', idle);
  if (idle > 170 || runPotato > 260) throw new Error('fps cap not honored');
});
step('desert + boss + storms + 30s', () => {
  g.state.wave = 19;
  g.switchToDesert();
  g.spawnBoss();
  for (let i = 0; i < 3; i++) g.spawnSandstorm(g.vec(5 + i, 0, 5), { scale: 1, life: 5, dps: 10, radius: 1.8 });
  g.ff(30);
  for (let i = 0; i < 120; i++) runFrame(16.667);
  log('   boss hp', g.state.boss && g.state.boss.hp, 'particles', g.state.particles.length, 'storms', g.state.storms.length);
});
step('spawn lots of particles (cap check)', () => {
  for (let i = 0; i < 50; i++) g.damageTurret(g.state.turrets[0] || { dead: true, hp: 1, maxHp: 1, hpBar: { set() {} }, group: { position: g.vec(0, 0, 0) } }, 0);
  for (let i = 0; i < 100; i++) g.spawnZombie('normal');
  for (const z of g.state.zombies) g.damageZombie(z, 99999, { showNumber: true });
  log('   particles', g.state.particles.length, 'perf', JSON.stringify(g.perf()));
  for (let i = 0; i < 60; i++) runFrame(16.667);
});

// ---------- resize / graphics button / all tiers ----------
step('resize to 4K @ DPR 2', () => {
  globalThis.innerWidth = 3840; globalThis.innerHeight = 2160; globalThis.devicePixelRatio = 2;
  dispatch('window', 'resize', {});
  const p = g.perf();
  log('   pixelRatio', p.pixelRatio, 'canvas', p.canvas, 'pixels', p.canvas[0] * p.canvas[1]);
  if (p.canvas[0] * p.canvas[1] > 2.2e6) throw new Error('pixel budget exceeded');
});
step('cycle graphics button 6 times', () => {
  for (let i = 0; i < 6; i++) {
    getElementById('btn-gfx').onclick();
    const p = g.perf();
    log('   ', getElementById('btn-gfx').textContent, '| tier', p.tier, 'locked', p.locked, 'ratio', p.pixelRatio, 'canvas', p.canvas.join('x'), 'shadows', p.shadows, 'saved=', JSON.stringify(localStorage.getItem('bradyZombieQuality')));
    for (let i = 0; i < 20; i++) runFrame(16.667);
  }
});
step('applyQuality every tier directly', () => {
  for (const t of ['high', 'medium', 'low', 'potato', 'high', 'bogus']) { g.applyQuality(t); runFrame(16.667); runFrame(40); }
});

// ---------- governor: slow frames -> step down -> panic ----------
step('governor steps down under sustained 80ms frames', () => {
  g.governor.setTier('high', false);
  g.applyQuality('high');
  const before = g.perf().tier;
  for (let i = 0; i < 400; i++) runFrame(80);
  const after = g.perf().tier;
  log('   tier', before, '->', after, 'ema', g.perf().emaMs, 'overlay hidden:', getElementById('perf-overlay').classList.contains('hidden'));
  if (after === before) throw new Error('governor never stepped down');
});
step('panic brake on 3 x 700ms frames, then resume', () => {
  getElementById('perf-overlay').classList.add('hidden');
  // the random battles above can knock the base down; game time is frozen after
  // game over, so revive the game or "did it resume?" can't be measured.
  g.state.over = false;
  g.state.baseHp = 99999; g.player.hp = 99999;
  for (let i = 0; i < 4; i++) runFrame(700);
  const shown = !getElementById('perf-overlay').classList.contains('hidden');
  log('   overlay shown:', shown, 'perf-tier text:', getElementById('perf-tier').textContent, 'tier', g.perf().tier);
  if (!shown) throw new Error('panic brake did not engage');
  // while paused, frames must not render or simulate
  const t0 = g.state.time;
  for (let i = 0; i < 30; i++) runFrame(16.667);
  if (g.state.time !== t0) throw new Error('sim ran while perf-paused');
  const rc = globalThis.__rendererInstance.renderCount;
  for (let i = 0; i < 30; i++) runFrame(16.667);
  if (globalThis.__rendererInstance.renderCount !== rc) throw new Error('rendered while perf-paused');
  if (g.state.shopOpen) throw new Error('harness: shop open');
  getElementById('perf-resume').onclick();
  for (let i = 0; i < 30; i++) runFrame(16.667);
  if (g.state.time === t0) throw new Error('sim did not resume');
});
step('hidden-tab watchdog path', () => {
  document.hidden = true; document.visibilityState = 'hidden';
  dispatch('document', 'visibilitychange', {});
  advance(5000);
  // emulate the setInterval body: we cannot wait for the real timer, so at least run a frame with a huge gap
  runFrame(5000);
  document.hidden = false; document.visibilityState = 'visible';
  dispatch('window', 'blur', {});
});
step('snapshot()', () => { const d = g.snapshot(); if (!d.startsWith('data:')) throw new Error('bad dataurl'); });
step('game over path', () => {
  g.state.baseHp = 1;
  g.state.boss = null;
  // damage base via a zombie reaching it is indirect; call through a hacked turret? simplest: spawn zombies at base and ff
  for (let i = 0; i < 5; i++) g.spawnZombie('buff', g.vec(0.5, 0, 0.5));
  g.ff(20);
  log('   over:', g.state.over, 'gameover hidden:', getElementById('gameover').classList.contains('hidden'));
  for (let i = 0; i < 30; i++) runFrame(16.667);   // game-over idle path
  getElementById('btn-again').onclick();
});

log('unknown DOM ids requested (final):', JSON.stringify([...new Set(unknownIds)]));
log(failures ? `DONE with ${failures} FAILURES` : 'DONE, no failures');
process.exit(failures ? 1 : 0);
