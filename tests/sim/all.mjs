// End-to-end smoke test: runs js/main.js under Node (real three.js r161 object model,
// only WebGLRenderer + DOM stubbed) in several GPU modes. No browser, no GPU, no risk.
//   node tests/sim/all.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
if (!fs.existsSync(path.join(here, 'three.module.js'))) {
  console.error('tests/sim/three.module.js missing — copy three@0.161.0/build/three.module.js here (same file index.html loads from the CDN).');
  process.exit(2);
}
// stage the game modules with `three` pointed at the stub
fs.mkdirSync(path.join(here, 'js'), { recursive: true });
for (const f of ['main.js', 'models.js', 'config.js', 'audio.js', 'quality.js']) {
  const src = fs.readFileSync(path.join(root, 'js', f), 'utf8').replace(/from 'three'/g, "from '../three-stub.mjs'");
  fs.writeFileSync(path.join(here, 'js', f), src);
}
let failed = 0;
for (const mode of ['hw', 'sw', 'noext', 'saved', 'nogl']) {
  const r = spawnSync(process.execPath, [path.join(here, 'run.mjs'), mode], {
    cwd: here, encoding: 'utf8', env: { ...process.env, INDEX_HTML: path.join(root, 'index.html') },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0 && /DONE, no failures/.test(out);
  console.log(`${ok ? 'PASS' : 'FAIL'}  mode=${mode}`);
  if (!ok) { failed++; console.log(out.split('\n').slice(-40).join('\n')); }
}
console.log(failed ? `${failed} mode(s) FAILED` : 'all modes passed');
process.exit(failed ? 1 : 0);
