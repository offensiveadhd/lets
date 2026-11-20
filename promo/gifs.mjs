// Cuts the README animations out of the footage: palette-optimised GIFs and small MP4s, written straight
// into the repos that show them (the lets repos sit side by side in one folder).
//
//   node promo/gifs.mjs              every cuts/*.json
//   node promo/gifs.mjs graph den    only those
//
// A cuts file names its footage and lists the cuts:
//
//   { "footage": "graph",
//     "cuts": [
//       { "to": ["lets-unique-graph/assets/demo.gif"], "from": "draw.start-0.4", "end": "layout.done+1.5",
//         "width": 720, "fps": 12, "crop": [0, 0, 1280, 720], "speed": 1, "maxKb": 2500 },
//       { "to": ["lets-unique-graph/assets/demo.mp4"], "width": 1280 } ] }
//
// Times are seconds, or a mark from the footage's sidecar with an offset: "ghost.shown", "ghost.shown+1.5",
// "run.done-0.3", the n-th of a repeated mark as "press#2", and "start" / "end". Several ranges become one
// cut with "segments": [["a", "b"], ["c", "d"]]. A crop is [x, y, w, h] in the page's CSS pixels. A ".mp4"
// target is encoded as H.264 instead of a GIF. Marks move with every take, so cuts never name raw seconds
// unless they mean them.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FOOTAGE = path.join(HERE, 'footage');
const only = process.argv.slice(2);

function timeOf(expr, meta) {
  if (typeof expr === 'number') return expr;
  if (expr === 'start') return 0;
  if (expr === 'end') return meta.seconds;
  const m = /^(.+?)(?:#(\d+))?([+-]\d+(?:\.\d+)?)?$/.exec(String(expr));
  const hits = meta.marks.filter((k) => k.what === m[1]);
  const mark = hits[(Number(m[2]) || 1) - 1];
  if (!mark) throw new Error(`${meta.name}: no mark "${m[1]}"${m[2] ? ` #${m[2]}` : ''} (have: ${[...new Set(meta.marks.map((k) => k.what))].join(', ')})`);
  return Math.max(0, Math.min(meta.seconds, mark.t + (Number(m[3]) || 0)));
}

function cut(c, meta, src) {
  const k = meta.width / meta.css.width;                         // footage pixels per CSS pixel
  const ranges = (c.segments || [[c.from ?? 'start', c.end ?? 'end']]).map(([a, b]) => [timeOf(a, meta), timeOf(b, meta)]);
  for (const [a, b] of ranges) if (!(b > a)) throw new Error(`${meta.name}: empty range ${a}..${b} in ${JSON.stringify(c.to)}`);
  const speed = c.speed || 1;
  const crop = c.crop ? `crop=${Math.round(c.crop[2] * k)}:${Math.round(c.crop[3] * k)}:${Math.round(c.crop[0] * k)}:${Math.round(c.crop[1] * k)},` : '';
  const parts = ranges.map(([a, b], i) => `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=(PTS-STARTPTS)/${speed}[s${i}]`).join(';');
  const cat = `${ranges.map((_, i) => `[s${i}]`).join('')}concat=n=${ranges.length}:v=1:a=0[cat]`;
  const seconds = ranges.reduce((s, [a, b]) => s + (b - a), 0) / speed;
  for (const rel of c.to) {
    const file = path.resolve(ROOT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let args;
    if (/\.mp4$/i.test(file)) {
      const width = c.width || 1280;
      args = ['-i', src, '-filter_complex', `${parts};${cat};[cat]${crop}scale=${width}:-2:flags=lanczos,format=yuv420p[v]`, '-map', '[v]', '-r', String(c.fps || 30), '-c:v', 'libx264', '-preset', 'slow', '-crf', String(c.crf || 30), '-movflags', '+faststart', '-an', file];
    } else {
      const width = c.width || 720, fps = c.fps || 12, colors = c.colors || 144;
      const dither = c.dither || 'bayer:bayer_scale=4';
      args = ['-i', src, '-filter_complex', `${parts};${cat};[cat]${crop}fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`, '-loop', '0', file];
    }
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${rel}`);
    const kb = Math.round(fs.statSync(file).size / 1024);
    const budget = c.maxKb || (/\.mp4$/i.test(file) ? 2000 : 2500);
    console.log(`  ${rel.padEnd(52)} ${seconds.toFixed(1).padStart(5)} s ${String(kb).padStart(6)} KB${kb > budget ? `   OVER the ${budget} KB budget` : ''}`);
  }
}

const dir = path.join(HERE, 'cuts');
// tour.json is the tour's own (several clips in one film): tour.mjs cuts it
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'tour.json' && (!only.length || only.includes(f.replace(/\.json$/, ''))));
if (!files.length) { console.error('no cuts files match'); process.exit(2); }
let failed = 0;
for (const f of files) {
  const spec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const src = path.join(FOOTAGE, `${spec.footage}.mp4`);
  const side = path.join(FOOTAGE, `${spec.footage}.json`);
  if (!fs.existsSync(src) || !fs.existsSync(side)) { console.error(`${f}: no footage "${spec.footage}" (run: node promo/record.mjs ${spec.footage})`); failed++; continue; }
  const meta = JSON.parse(fs.readFileSync(side, 'utf8'));
  console.log(`${f}  (${spec.footage}.mp4, ${meta.seconds.toFixed(1)} s)`);
  for (const c of spec.cuts) { try { cut(c, meta, src); } catch (err) { console.error(`  ${err.message}`); failed++; } }
}
process.exit(failed ? 1 : 0);
