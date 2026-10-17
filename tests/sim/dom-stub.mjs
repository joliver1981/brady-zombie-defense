// Minimal browser environment so js/main.js can be imported and driven in Node.
import fs from 'node:fs';

const listeners = new Map();
function addL(target, type, fn) {
  const key = target + ':' + type;
  if (!listeners.has(key)) listeners.set(key, []);
  listeners.get(key).push(fn);
}
export function dispatch(target, type, ev = {}) {
  const fns = listeners.get(target + ':' + type) || [];
  ev.preventDefault = ev.preventDefault || (() => {});
  for (const fn of fns) fn(ev);
  return fns.length;
}

// --- fake clock (performance.now) ---
let fakeNow = 1000;
export function setFakeNow(v) { fakeNow = v; }
export function advance(ms) { fakeNow += ms; }
globalThis.__advanceFakeTime = advance;
const perfObj = { now: () => fakeNow, mark() {}, measure() {} };
try { globalThis.performance = perfObj; } catch { Object.defineProperty(globalThis, 'performance', { value: perfObj, configurable: true, writable: true }); }
if (globalThis.performance.now() !== fakeNow) throw new Error('could not install fake performance.now');

// --- elements ---
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c) { this.set.has(c) ? this.set.delete(c) : this.set.add(c); }
}
export class El {
  constructor(tag = 'div', id = null) {
    this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.parentNode = null;
    this.classList = new ClassList(this); this.style = {}; this.dataset = {};
    this.textContent = ''; this._innerHTML = ''; this.title = ''; this.disabled = false;
    this.onclick = null; this.offsetWidth = 100; this.width = 300; this.height = 150;
    this._className = '';
  }
  get className() { return this._className; }
  set className(v) { this._className = v; this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = String(v); this.children = []; }
  appendChild(c) { if (!c || typeof c !== 'object') throw new Error('appendChild non-element'); c.parentNode = this; this.children.push(c); return c; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); }
  addEventListener(type, fn) { addL(this.id || this.tagName, type, fn); }
  removeEventListener() {}
  blur() {}
  focus() {}
  closest(sel) { return sel === 'button' && this.tagName === 'BUTTON' ? this : null; }
  querySelectorAll() { return []; }
  getContext(type) {
    if (type === '2d') return ctx2d;
    if (type === 'webgl2' || type === 'webgl') return globalThis.__fakeGL === undefined ? null : globalThis.__fakeGL;
    return null;
  }
  toDataURL() { return 'data:image/jpeg;base64,AAAA'; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
}
const ctx2d = {
  fillStyle: '#000', fillRect() {}, clearRect() {}, getImageData() { return { data: new Uint8ClampedArray(4) }; },
};

// ids from index.html
const html = fs.readFileSync(process.env.INDEX_HTML, 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const byId = new Map();
for (const id of ids) byId.set(id, new El('div', id));
const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((m) => { const b = new El('button'); b.dataset.tab = m[1]; return b; });
export const elements = byId;
export const getElementById = (id) => byId.get(id) || null;

export const unknownIds = [];
const document = {
  body: new El('body'),
  hidden: false,
  visibilityState: 'visible',
  getElementById(id) { const e = byId.get(id); if (!e) unknownIds.push(id); return e || null; },
  createElement(tag) { return new El(tag); },
  createElementNS(ns, tag) { return new El(tag); },
  querySelectorAll(sel) { if (sel === '#shop-tabs .tab') return tabs; return []; },
  querySelector() { return null; },
  addEventListener(type, fn) { addL('document', type, fn); },
  removeEventListener() {},
};
globalThis.document = document;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
globalThis.cancelAnimationFrame = () => {};
export function runFrame(advanceMs = 16.667) {
  advance(advanceMs);
  const cb = rafCb; rafCb = null;
  if (!cb) throw new Error('no rAF callback registered');
  cb(fakeNow);
}

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
globalThis.devicePixelRatio = 1;
globalThis.location = { reload() { globalThis.__reloaded = (globalThis.__reloaded || 0) + 1; } };
globalThis.addEventListener = (type, fn) => addL('window', type, fn);
globalThis.removeEventListener = () => {};
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', hardwareConcurrency: 4 }, configurable: true }); } catch {}
// no AudioContext on purpose (audio.js must survive that)
