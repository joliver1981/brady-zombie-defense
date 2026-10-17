// Re-export the real three.js r161 but replace WebGLRenderer with a JS-only stub
// so main.js can be executed under Node and every non-GPU code path is exercised.
export * from './three.module.js';
import * as T from './three.module.js';

export class WebGLRenderer {
  constructor(params = {}) {
    this.params = params; globalThis.__rendererInstance = this;
    globalThis.__rendererParams = params;
    this.domElement = document.createElement('canvas');
    this.domElement.width = 300;
    this.domElement.height = 150;
    this.shadowMap = { type: 0, enabled: false, needsUpdate: false, autoUpdate: true };
    this.info = { render: { calls: 0, triangles: 0, frame: 0 } };
    this._pr = 1;
    this._w = 300; this._h = 150;
    this.renderCount = 0;
    this.renderLog = [];
    this.simulatedRenderCostMs = 0;
  }
  setPixelRatio(v) { if (!(v > 0)) throw new Error('bad pixel ratio ' + v); this._pr = v; this.setSize(this._w, this._h); }
  getPixelRatio() { return this._pr; }
  setSize(w, h) {
    this._w = w; this._h = h;
    this.domElement.width = Math.floor(w * this._pr);
    this.domElement.height = Math.floor(h * this._pr);
  }
  getRenderTarget() { return null; }
  getContext() { return null; }
  render(scene, camera) {
    this.renderCount++;
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    let calls = 0, tris = 0;
    scene.traverse((o) => {
      if (!o.visible) return;
      if (o.isInstancedMesh) {
        if (o.count > o.instanceMatrix.count) throw new Error('InstancedMesh count ' + o.count + ' > pool ' + o.instanceMatrix.count);
        const a = o.instanceMatrix.array;
        for (let i = 0; i < o.count * 16; i++) if (!Number.isFinite(a[i])) throw new Error('NaN in instanceMatrix at ' + i);
        if (o.instanceColor) {
          const c = o.instanceColor.array;
          for (let i = 0; i < o.count * 3; i++) if (!Number.isFinite(c[i])) throw new Error('NaN in instanceColor at ' + i);
        }
        if (o.count > 0) calls++;
        return;
      }
      if (o.isMesh || o.isSprite) {
        calls++;
        const p = o.matrixWorld.elements;
        for (let i = 0; i < 16; i++) if (!Number.isFinite(p[i])) throw new Error('NaN matrixWorld on ' + (o.name || o.type));
        if (!o.material) throw new Error('mesh without material: ' + o.type);
        if (Array.isArray(o.material)) return;
        if (o.material.needsUpdate === undefined && !o.material.isMaterial) throw new Error('non-material assigned');
      }
    });
    this.info.render.calls = calls;
    this.info.render.triangles = tris;
    this.info.render.frame++;
    if (this.simulatedRenderCostMs) globalThis.__advanceFakeTime(this.simulatedRenderCostMs);
    this.renderLog.push(globalThis.performance.now());
  }
  dispose() {}
}
