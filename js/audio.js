// Tiny WebAudio sound effects — everything is synthesized, no sound files needed.

let ctx = null;
let muted = false;

export function initAudio() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      ctx = null;
    }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function toggleMute() {
  muted = !muted;
  return muted;
}

export function isMuted() { return muted; }

function beep(freq, dur = 0.1, type = 'square', vol = 0.15, slideTo = null, delay = 0) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Noise buffers are cached per duration — generating fresh random buffers for
// every hit sound was needless allocation churn.
const noiseBuffers = new Map();
function noiseBuffer(dur) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  let buf = noiseBuffers.get(len);
  if (!buf) {
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    noiseBuffers.set(len, buf);
  }
  return buf;
}

function noise(dur = 0.15, vol = 0.12, freq = 1000, delay = 0) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const buf = noiseBuffer(dur);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t0);
}

// Rate limiting: with 20 turrets firing and 30 zombies swinging, the game could
// start hundreds of audio nodes per second. Identical sounds are spaced out and
// there's a global ceiling, so the audio thread never becomes the bottleneck.
const lastPlayed = new Map();
const MIN_SAME_SOUND_GAP_MS = 45;
const MAX_SOUNDS_PER_100MS = 12;
let windowStart = 0, windowCount = 0;
function canPlay(name) {
  const now = performance.now();
  if (now - windowStart > 100) { windowStart = now; windowCount = 0; }
  if (windowCount >= MAX_SOUNDS_PER_100MS) return false;
  if (now - (lastPlayed.get(name) || 0) < MIN_SAME_SOUND_GAP_MS) return false;
  lastPlayed.set(name, now);
  windowCount++;
  return true;
}
function throttled(table) {
  const out = {};
  for (const [name, fn] of Object.entries(table)) out[name] = () => { if (canPlay(name)) fn(); };
  return out;
}

export const sfx = throttled({
  shoot()      { beep(880, 0.06, 'square', 0.06, 440); },
  playerShoot(){ beep(1200, 0.07, 'sawtooth', 0.07, 500); },
  melee()      { noise(0.08, 0.1, 2500); },
  hit()        { noise(0.06, 0.08, 1500); },
  block()      { beep(220, 0.08, 'square', 0.12, 180); noise(0.05, 0.06, 4000); },
  coin()       { beep(988, 0.07, 'sine', 0.12); beep(1319, 0.12, 'sine', 0.12, null, 0.07); },
  gem()        { beep(1568, 0.08, 'sine', 0.12); beep(2093, 0.14, 'sine', 0.12, null, 0.08); },
  rescue()     { beep(523, 0.09, 'triangle', 0.14); beep(659, 0.09, 'triangle', 0.14, null, 0.09); beep(784, 0.09, 'triangle', 0.14, null, 0.18); beep(1047, 0.16, 'triangle', 0.14, null, 0.27); },
  buy()        { beep(660, 0.06, 'sine', 0.12); beep(880, 0.1, 'sine', 0.12, null, 0.06); },
  place()      { noise(0.1, 0.12, 800); beep(330, 0.1, 'sine', 0.1); },
  heal()       { beep(440, 0.1, 'sine', 0.12, 660); beep(660, 0.12, 'sine', 0.1, 880, 0.1); },
  zombieDie()  { beep(150, 0.25, 'sawtooth', 0.12, 60); },
  turretDie()  { noise(0.35, 0.2, 500); beep(120, 0.3, 'sawtooth', 0.12, 40); },
  baseHit()    { noise(0.2, 0.18, 400); },
  playerHurt() { beep(200, 0.12, 'sawtooth', 0.12, 120); },
  stun()       { beep(700, 0.1, 'sine', 0.12, 300); beep(500, 0.15, 'sine', 0.1, 200, 0.1); },
  hack()       { beep(1000, 0.05, 'square', 0.09, 1400); beep(1400, 0.05, 'square', 0.09, 700, 0.06); beep(600, 0.08, 'square', 0.09, 1600, 0.12); },
  fire()       { noise(0.3, 0.1, 900); },
  storm()      { noise(0.5, 0.14, 700); noise(0.4, 0.1, 400, 0.2); },
  acid()       { noise(0.25, 0.08, 3000); beep(300, 0.15, 'sine', 0.07, 150); },
  robot()      { beep(440, 0.08, 'square', 0.1); beep(660, 0.08, 'square', 0.1, null, 0.1); beep(880, 0.1, 'square', 0.1, null, 0.2); },
  loot()       { beep(988, 0.07, 'sine', 0.14); beep(1319, 0.07, 'sine', 0.14, null, 0.08); beep(1568, 0.07, 'sine', 0.14, null, 0.16); beep(2093, 0.2, 'sine', 0.16, null, 0.24); },
  upgrade()    { noise(0.12, 0.14, 900); beep(523, 0.1, 'triangle', 0.13, null, 0.15); beep(784, 0.1, 'triangle', 0.13, null, 0.28); beep(1047, 0.2, 'triangle', 0.15, null, 0.4); },
  recruit()    { beep(659, 0.09, 'triangle', 0.13); beep(880, 0.14, 'triangle', 0.14, null, 0.1); },
  quake()      { noise(0.7, 0.22, 250); beep(60, 0.7, 'sawtooth', 0.18, 40); },
  roar()       { beep(120, 0.5, 'sawtooth', 0.2, 60); beep(90, 0.6, 'sawtooth', 0.18, 45, 0.25); noise(0.5, 0.12, 500, 0.1); },
  repair()     { beep(660, 0.05, 'square', 0.1); beep(880, 0.08, 'sine', 0.1, null, 0.06); },
  bossDie()    { beep(200, 0.4, 'sawtooth', 0.18, 60); beep(523, 0.15, 'triangle', 0.14, null, 0.45); beep(659, 0.15, 'triangle', 0.14, null, 0.6); beep(784, 0.3, 'triangle', 0.16, null, 0.75); },
  waveStart()  { beep(392, 0.15, 'square', 0.12); beep(392, 0.15, 'square', 0.12, null, 0.18); beep(523, 0.3, 'square', 0.14, null, 0.36); },
  waveDone()   { beep(523, 0.12, 'triangle', 0.14); beep(659, 0.12, 'triangle', 0.14, null, 0.12); beep(784, 0.24, 'triangle', 0.14, null, 0.24); },
  gameOver()   { beep(392, 0.3, 'sawtooth', 0.14, 300); beep(330, 0.3, 'sawtooth', 0.14, 250, 0.3); beep(262, 0.6, 'sawtooth', 0.14, 130, 0.6); },
});
