// Run: node tests/quality.test.js
import assert from 'node:assert/strict';
import { computePixelRatio, isSoftwareRenderer, FrameGovernor, initialTier, TIER_SETTINGS, rateLimit } from '../js/quality.js';

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

// ---- pixel ratio cap ----
t('4K screen at DPR 2 is capped hard (was rendering 8.3Mpx)', () => {
  const r = computePixelRatio(3840, 2160, 2, TIER_SETTINGS.high.maxPixels);
  assert.ok(3840 * r * 2160 * r <= TIER_SETTINGS.high.maxPixels + 1);
  assert.ok(r < 0.6 && r >= 0.3);
});
t('1440p laptop at DPR 1.5 never supersamples (ratio <= 1)', () => {
  const r = computePixelRatio(2560, 1440, 1.5, TIER_SETTINGS.high.maxPixels);
  assert.ok(r <= 1 && 2560 * r * 1440 * r <= TIER_SETTINGS.high.maxPixels + 1);
});
t('small 1280x720 window renders at native 1:1', () => {
  assert.equal(computePixelRatio(1280, 720, 1, TIER_SETTINGS.high.maxPixels), 1);
});
t('potato tier on 1080p drops well below native; floor is 0.3', () => {
  const r = computePixelRatio(1920, 1080, 1, TIER_SETTINGS.potato.maxPixels);
  assert.ok(r < 0.45 && r >= 0.3);
  assert.equal(computePixelRatio(7680, 4320, 3, TIER_SETTINGS.potato.maxPixels), 0.3);
});

// ---- software renderer detection ----
t('detects SwiftShader / llvmpipe / Basic Render (RDP) as software', () => {
  assert.ok(isSoftwareRenderer('Google SwiftShader'));
  assert.ok(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'));
  assert.ok(isSoftwareRenderer('Mesa/X.org, llvmpipe (LLVM 15.0.7, 256 bits)'));
  assert.ok(isSoftwareRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)'));
});
t('real GPUs are not flagged', () => {
  assert.equal(isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'), false);
  assert.equal(isSoftwareRenderer('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'), false);
  assert.equal(isSoftwareRenderer(''), false);
});

// ---- initial tier ----
t('software renderer starts at potato (auto)', () => {
  assert.deepEqual(initialTier({ saved: null, softwareRenderer: true, rendererString: 'SwiftShader' }), { tier: 'potato', locked: false });
});
t('saved manual choice wins and locks', () => {
  assert.deepEqual(initialTier({ saved: 'low', softwareRenderer: false, rendererString: 'NVIDIA' }), { tier: 'low', locked: true });
});
t('UNKNOWN renderer string starts medium (no MSAA), known GPU starts high', () => {
  assert.deepEqual(initialTier({ saved: null, softwareRenderer: false, rendererString: '' }), { tier: 'medium', locked: false });
  assert.deepEqual(initialTier({ saved: 'garbage', softwareRenderer: false, rendererString: 'Intel UHD' }), { tier: 'high', locked: false });
});

// ---- governor: steady good frames never change tier ----
t('60fps for 30s: stays high, no panic', () => {
  const g = new FrameGovernor({ tier: 'high' });
  let now = 0;
  for (let i = 0; i < 1800; i++) { now += 16; const r = g.sample(8, 16, now); assert.equal(r.changed, false); assert.equal(r.panic, false); }
  assert.equal(g.tier, 'high');
});

// ---- governor: sustained slowness steps down gradually, with cooldown ----
t('sustained 60ms frames: high -> medium after ~2s, then low after cooldown, one step at a time', () => {
  const g = new FrameGovernor({ tier: 'high' });
  let now = 0; const changes = [];
  for (let i = 0; i < 400; i++) { now += 60; const r = g.sample(55, 60, now); if (r.changed) changes.push({ at: now, tier: r.tier }); assert.equal(r.panic, false); }
  assert.ok(changes.length >= 2);
  assert.equal(changes[0].tier, 'medium');
  assert.equal(changes[1].tier, 'low');
  assert.ok(changes[0].at >= 2000 && changes[0].at < 5000);
  assert.ok(changes[1].at - changes[0].at >= 4000);
});

// ---- governor: manual lock blocks gradual changes only ----
t('locked tier: 80ms frames do not change tier', () => {
  const g = new FrameGovernor({ tier: 'high', locked: true });
  let now = 0;
  for (let i = 0; i < 200; i++) { now += 80; const r = g.sample(80, 80, now); assert.equal(r.changed, false); }
  assert.equal(g.tier, 'high');
});

// ---- governor: panic brake ----
t('three consecutive 700ms frames => panic + step down', () => {
  const g = new FrameGovernor({ tier: 'high' });
  let now = 0, r;
  for (let i = 0; i < 3; i++) { now += 700; r = g.sample(700, 700, now); }
  assert.equal(r.panic, true); assert.equal(r.tier, 'medium'); assert.equal(r.changed, true);
});
t('CATASTROPHIC 3-second visible frames are NOT ignored: panic fires', () => {
  const g = new FrameGovernor({ tier: 'high' });
  let now = 0, r;
  for (let i = 0; i < 3; i++) { now += 3000; r = g.sample(50, 3000, now); }   // tiny CPU work, huge gap (GPU-bound)
  assert.equal(r.panic, true);
});
t('panic overrides a manual lock: steps down and returns to auto', () => {
  const g = new FrameGovernor({ tier: 'high', locked: true });
  let now = 0, r;
  for (let i = 0; i < 3; i++) { now += 700; r = g.sample(700, 700, now); }
  assert.equal(r.panic, true); assert.equal(r.tier, 'medium'); assert.equal(g.locked, false);
});
t('one GC hiccup (single 900ms frame) does NOT panic', () => {
  const g = new FrameGovernor({ tier: 'high' });
  let now = 0;
  for (let i = 0; i < 60; i++) { now += 16; g.sample(8, 16, now); }
  now += 900;
  const r = g.sample(900, 900, now);
  assert.equal(r.panic, false); assert.equal(g.tier, 'high');
});
t('after a panic, resuming with normal frames does not immediately re-panic', () => {
  const g = new FrameGovernor({ tier: 'high' });
  let now = 0, r;
  for (let i = 0; i < 3; i++) { now += 700; r = g.sample(700, 700, now); }
  for (let i = 0; i < 30; i++) { now += 16; r = g.sample(10, 16, now); assert.equal(r.panic, false); }
});
t('gap null (just un-hidden) is ignored: only work counts', () => {
  const g = new FrameGovernor({ tier: 'high' });
  let now = 0;
  for (let i = 0; i < 10; i++) { now += 5000; const r = g.sample(5, null, now); assert.equal(r.panic, false); assert.equal(r.changed, false); }
  assert.equal(g.tier, 'high');
});
t('potato is the floor: panic reports atFloor, no further step', () => {
  const g = new FrameGovernor({ tier: 'potato' });
  let now = 0, r;
  for (let i = 0; i < 3; i++) { now += 700; r = g.sample(700, 700, now); }
  assert.equal(r.panic, true); assert.equal(r.changed, false); assert.equal(r.atFloor, true); assert.equal(g.tier, 'potato');
});
t('potato floor: sustained 200ms frames (software renderer at 100% duty) trigger a pause', () => {
  const g = new FrameGovernor({ tier: 'potato' });
  let now = 0, panicked = false;
  for (let i = 0; i < 60 && !panicked; i++) { now += 200; panicked = g.sample(200, 200, now).panic; }
  assert.ok(panicked, 'expected floor panic');
});
t('high tier: sustained 200ms frames step down rather than pause', () => {
  const g = new FrameGovernor({ tier: 'high' });
  let now = 0, r;
  for (let i = 0; i < 40; i++) { now += 200; r = g.sample(200, 200, now); assert.equal(r.panic, false); }
  assert.notEqual(g.tier, 'high');
});

// ---- rate limiter ----
function measureFps(rafHz, capFps, seconds = 10) {
  let acc = 0, renders = 0; const gap = 1000 / rafHz;
  for (let i = 0; i < rafHz * seconds; i++) { const r = rateLimit(acc, gap, capFps); acc = r.acc; if (r.render) renders++; }
  return renders / seconds;
}
t('rate limiter: 60Hz display, 60 cap => ~60fps', () => { const f = measureFps(60, 60); assert.ok(f >= 58, 'fps ' + f); });
t('rate limiter: 144Hz display, 60 cap => ~60fps (not 72, not 48)', () => { const f = measureFps(144, 60); assert.ok(f >= 57 && f <= 63, 'fps ' + f); });
t('rate limiter: 30Hz display, 24 cap => ~24fps (no 15fps dead zone)', () => { const f = measureFps(30, 24); assert.ok(f >= 22 && f <= 26, 'fps ' + f); });
t('rate limiter: 60Hz display, 15 cap (menus) => ~15fps', () => { const f = measureFps(60, 15); assert.ok(f >= 14 && f <= 16, 'fps ' + f); });
t('rate limiter: a 3s stall yields at most one extra frame, never a catch-up burst', () => {
  let r = rateLimit(0, 3000, 60); assert.equal(r.render, true); assert.ok(r.acc <= 1000 / 60 + 0.01);
  let extra = 0;
  for (let i = 0; i < 10; i++) { r = rateLimit(r.acc, 1, 60); if (r.render) extra++; }   // ten 1ms "frames"
  assert.ok(extra <= 1, 'extra renders after stall: ' + extra);
});

console.log(`\n${passed} tests passed`);
