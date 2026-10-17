// Graphics quality governor — pure logic, no three.js, so it can be unit-tested in Node.
//
// Why this exists: the game used to render at full device resolution with MSAA,
// shadows and hundreds of draw calls, 60 times a second, with no way to back off.
// On weak GPUs, high-DPI screens, or Remote Desktop (software WebGL) that pins the
// whole machine. This module caps the work and adapts it to measured frame times.

export const TIERS = ['high', 'medium', 'low', 'potato'];

export const TIER_SETTINGS = {
  //                internal pixel budget   shadow map  particles  fps cap
  high:   { maxPixels: 2.1e6,  shadowMap: 1024, particles: 250, fpsCap: 60 },
  medium: { maxPixels: 1.3e6,  shadowMap: 512,  particles: 150, fpsCap: 60 },
  low:    { maxPixels: 0.75e6, shadowMap: 0,    particles: 80,  fpsCap: 30 },
  potato: { maxPixels: 0.35e6, shadowMap: 0,    particles: 40,  fpsCap: 15 },
};

// Software / virtualized renderers that will melt under a real 3D load.
export const SOFTWARE_RENDERER_RE = /swiftshader|llvmpipe|softpipe|software|microsoft basic render|mesa offscreen|virtualbox|vmware svga/i;

export function isSoftwareRenderer(rendererString) {
  return !!rendererString && SOFTWARE_RENDERER_RE.test(rendererString);
}

// Pixel ratio so that canvas width*height*ratio^2 <= maxPixels.
// Never above 1 (no supersampling on retina screens) and never below 0.3.
export function computePixelRatio(cssWidth, cssHeight, devicePixelRatio, maxPixels) {
  const w = Math.max(1, cssWidth), h = Math.max(1, cssHeight);
  const cap = Math.sqrt(maxPixels / (w * h));
  return Math.max(0.3, Math.min(1, devicePixelRatio || 1, cap));
}

// Frame-time governor: feed it one sample per rendered frame.
//   sample(workMs, gapMs, now) -> { tier, changed, panic, atFloor }
//  - workMs: time spent inside the frame (sim + render submit)
//  - gapMs:  time since the previous frame while the tab was VISIBLE
//            (pass null for the first frame after the tab becomes visible again)
export class FrameGovernor {
  constructor({ tier = 'high', locked = false, now = 0 } = {}) {
    this.tier = tier;
    this.locked = locked;          // manual override: no gradual auto-change (panic still acts)
    this.ema = 16;
    this.slowSince = null;         // when the EMA first went over the slow threshold
    this.lastChangeAt = -Infinity;
    this.panicStreak = 0;
    this.now = now;
    this.SLOW_MS = 40;             // ~25 fps sustained => step down
    this.SLOW_HOLD_MS = 2000;      // ...for this long
    this.COOLDOWN_MS = 4000;       // between automatic steps
    this.PANIC_FRAME_MS = 600;     // a single frame this slow is an emergency
    this.PANIC_STREAK = 3;         // ...if it happens this many times in a row
    this.PANIC_EMA_MS = 250;       // or the average is this bad
    this.PANIC_EMA_FLOOR_MS = 150; // at the lowest tier, pausing is the only lever left: do it sooner
  }

  get atFloor() { return TIERS.indexOf(this.tier) >= TIERS.length - 1; }

  sample(workMs, gapMs, now) {
    if (now !== undefined) this.now = now;
    // A visible frame is as slow as the longer of its work and the gap since the last one.
    // Do NOT clamp: a 3-second frame is a 3-second frame.
    const frame = Math.max(workMs || 0, gapMs == null ? 0 : gapMs);
    // EMA (clamped input so one pathological frame doesn't dominate the average for 10s)
    this.ema = this.ema * 0.9 + Math.min(frame, 1000) * 0.1;

    // --- panic brake ---
    if (frame > this.PANIC_FRAME_MS) this.panicStreak++;
    else this.panicStreak = 0;
    const emaLimit = this.atFloor ? this.PANIC_EMA_FLOOR_MS : this.PANIC_EMA_MS;
    const panic = this.panicStreak >= this.PANIC_STREAK || this.ema > emaLimit;
    if (panic) {
      this.panicStreak = 0;
      this.ema = this.SLOW_MS;   // reset so we don't re-panic instantly after resuming
      this.slowSince = null;
      // Panic overrides a manual lock: the machine is in trouble, step down and go back to auto.
      const changed = this.stepDown();
      this.locked = false;
      return { tier: this.tier, changed, panic: true, atFloor: this.atFloor };
    }

    // --- gradual adaptation ---
    if (this.locked) return { tier: this.tier, changed: false, panic: false, atFloor: this.atFloor };
    let changed = false;
    if (this.ema > this.SLOW_MS) {
      if (this.slowSince === null) this.slowSince = this.now;
      if (this.now - this.slowSince >= this.SLOW_HOLD_MS && this.now - this.lastChangeAt >= this.COOLDOWN_MS) {
        changed = this.stepDown();
        this.slowSince = null;
      }
    } else {
      this.slowSince = null;
    }
    return { tier: this.tier, changed, panic: false, atFloor: this.atFloor };
  }

  stepDown() {
    const i = TIERS.indexOf(this.tier);
    if (i >= TIERS.length - 1) return false;
    this.tier = TIERS[i + 1];
    this.lastChangeAt = this.now;
    return true;
  }

  setTier(tier, locked) {
    if (TIERS.includes(tier)) this.tier = tier;
    if (locked !== undefined) this.locked = locked;
    this.ema = 16;
    this.slowSince = null;
    this.panicStreak = 0;
  }
}

// Pick a starting tier. A saved manual choice wins; software renderers start at the
// bottom; an UNKNOWN renderer (masked / no debug info) starts in the middle without
// MSAA; a known real GPU starts high and lets the governor adapt.
export function initialTier({ saved, softwareRenderer, rendererString }) {
  if (saved && TIERS.includes(saved)) return { tier: saved, locked: true };
  if (softwareRenderer) return { tier: 'potato', locked: false };
  if (!rendererString) return { tier: 'medium', locked: false };
  return { tier: 'high', locked: false };
}

// Render-rate limiter with carry-over, so e.g. a 24fps cap on a 30Hz display really
// gives ~24fps instead of falling into a 15fps dead zone.
//   shouldRender(acc, gapMs, targetFps) -> { render, acc }
export function rateLimit(acc, gapMs, targetFps) {
  const interval = 1000 / targetFps;
  acc += gapMs;
  if (acc < interval - 0.5) return { render: false, acc };
  // carry the remainder so the real rate converges on the cap at any refresh rate,
  // clamped to one interval so a long stall yields at most ONE extra frame, never a burst
  return { render: true, acc: Math.min(acc - interval, interval) };
}
