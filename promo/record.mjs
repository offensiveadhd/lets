// Records the footage, one scene after another (never two at once: a second browser on the same machine
// drops the first one's frame rate).
//
//   node promo/record.mjs                 every scene in scenes/ (files that start with _ are tools, not scenes)
//   node promo/record.mjs graph cocode    only those
//   node promo/record.mjs --draft graph   at 1x with lighter frames, as a scene run by itself is
//
// These are the takes that count: 1920x1080 (PROMO_FINAL=1). A scene run by itself records a draft.
// Each scene is a script of its own (node promo/scenes/graph.mjs) that writes footage/<name>.mp4 and a
// <name>.json sidecar of marks. Then: node promo/gifs.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const all = fs.readdirSync(path.join(HERE, 'scenes')).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).map((f) => f.replace(/\.mjs$/, ''));
const argv = process.argv.slice(2);
const draft = argv.includes('--draft');
const names = argv.filter((a) => !a.startsWith('--'));
const want = names.length ? names : all;
const env = { ...process.env, PROMO_FINAL: draft ? '' : '1' };
const failed = [];
for (const name of want) {
  const file = path.join(HERE, 'scenes', `${name}.mjs`);
  if (!fs.existsSync(file)) { console.error(`no scene "${name}" (have: ${all.join(', ')})`); failed.push(name); continue; }
  console.log(`\n== ${name}`);
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit', cwd: path.resolve(HERE, '..'), env });
  if (r.status !== 0) failed.push(name);
}
if (failed.length) { console.error(`\nfailed: ${failed.join(', ')}`); process.exit(1); }
