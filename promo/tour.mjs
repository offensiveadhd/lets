// Cuts the family tour: a few seconds of each window, one after another, each under a caption. It is made
// of the same footage as the READMEs' own GIFs; the captions are the only thing added on top.
//
//   node promo/tour.mjs            reads cuts/tour.json  -> lets/assets/tour.gif + tour.mp4
//   node promo/tour.mjs --look     also keeps the caption PNGs in out/tour/ to look at
//
// cuts/tour.json:
//
//   { "gif": { "to": "lets/assets/tour.gif", "width": 720, "fps": 10, "colors": 128, "maxKb": 2400 },
//     "mp4": { "to": "lets/assets/tour.mp4", "width": 1280, "crf": 31, "maxKb": 1800 },
//     "parts": [
//       { "footage": "graph", "from": "claude.start-0.4", "end": "layout.done+1.2",
//         "name": "graph", "caption": "Draw it. Claude draws with you.", "speed": 1 } ] }
//
// Times are marks from the footage's sidecar with an offset, as in gifs.mjs. A part may carry "segments"
// instead of from/end, and a "crop": [x, y, w, h] in the page's CSS pixels (it is scaled back to 16:9, so
// keep the crop 16:9). The caption is drawn by the same headless browser the recorder uses, as a
// transparent PNG laid over the part, so the text is the same on every machine.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './lib/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FOOTAGE = path.join(HERE, 'footage');
const LOOK = process.argv.includes('--look');
const W = 1280, H = 720;

const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'cuts', 'tour.json'), 'utf8'));

function timeOf(expr, meta) {
  if (typeof expr === 'number') return expr;
  if (expr === 'start') return 0;
  if (expr === 'end') return meta.seconds;
  const m = /^(.+?)(?:#(\d+))?([+-]\d+(?:\.\d+)?)?$/.exec(String(expr));
  const hits = meta.marks.filter((k) => k.what === m[1]);
  const mark = hits[(Number(m[2]) || 1) - 1];
  if (!mark) throw new Error(`${meta.name}: no mark "${m[1]}" (have: ${[...new Set(meta.marks.map((k) => k.what))].join(', ')})`);
  return Math.max(0, Math.min(meta.seconds, mark.t + (Number(m[3]) || 0)));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// One caption: the window's name in the family's ink gradient, then what happens, on a soft violet bar.
const captionHtml = (name, text, n, total) => `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; background: transparent; overflow: hidden; }
  .bar { position: absolute; left: 36px; bottom: 34px; display: flex; align-items: center; gap: 16px; padding: 14px 24px 15px 20px;
         border-radius: 18px; background: rgba(18, 11, 31, .86); border: 1.5px solid rgba(90, 68, 160, .9);
         box-shadow: 0 10px 34px rgba(0, 0, 0, .45), 0 0 26px rgba(166, 107, 255, .22);
         font-family: Inter, 'Segoe UI', system-ui, -apple-system, sans-serif; }
  .orb { width: 22px; height: 22px; border-radius: 50%; flex: none;
         background: radial-gradient(circle at 38% 32%, #e3ccff 0, #a66bff 45%, #5a2fb0 100%); box-shadow: 0 0 14px rgba(166, 107, 255, .8); }
  .name { font-size: 30px; font-weight: 700; letter-spacing: .2px; background: linear-gradient(100deg, #c49bff, #ff8fe0);
          -webkit-background-clip: text; background-clip: text; color: transparent; }
  .text { font-size: 27px; font-weight: 400; color: #ece6ff; }
  .dots { position: absolute; right: 40px; bottom: 50px; display: flex; gap: 9px; }
  .dots i { width: 9px; height: 9px; border-radius: 50%; background: rgba(169, 156, 208, .45); }
  .dots i.on { background: #6bf0ff; box-shadow: 0 0 10px rgba(107, 240, 255, .8); }
</style><div class="bar"><span class="orb"></span><span class="name">${esc(name)}</span><span class="text">${esc(text)}</span></div>
<div class="dots">${Array.from({ length: total }, (_, i) => `<i${i === n ? ' class="on"' : ''}></i>`).join('')}</div>`;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-promo-tour-'));
const keep = path.join(HERE, 'out', 'tour');
let failed = false;
try {
  // ---- the captions, as transparent PNGs ------------------------------------------------------------
  const b = await launch({ w: W, h: H, scale: 1, port: Number(process.env.PROMO_DEBUG_PORT) || 9371 });
  try {
    await b.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    for (const [i, p] of spec.parts.entries()) {
      const html = path.join(work, `cap${i}.html`);
      fs.writeFileSync(html, captionHtml(p.name, p.caption, i, spec.parts.length));
      await b.goto(pathToFileURL(html).href, { settle: 250 });
      await b.shot(path.join(work, `cap${i}.png`));
      if (LOOK) { fs.mkdirSync(keep, { recursive: true }); fs.copyFileSync(path.join(work, `cap${i}.png`), path.join(keep, `cap${i}.png`)); }
    }
  } finally { await b.close(); }

  // ---- one filter graph: every part trimmed, scaled to 1280x720, captioned, then joined ---------------
  const inputs = [];
  const chains = [];
  let total = 0;
  for (const [i, p] of spec.parts.entries()) {
    const src = path.join(FOOTAGE, `${p.footage}.mp4`);
    const side = path.join(FOOTAGE, `${p.footage}.json`);
    if (!fs.existsSync(src) || !fs.existsSync(side)) throw new Error(`no footage "${p.footage}" (run: node promo/record.mjs ${p.footage})`);
    const meta = JSON.parse(fs.readFileSync(side, 'utf8'));
    const k = meta.width / meta.css.width;
    const ranges = (p.segments || [[p.from ?? 'start', p.end ?? 'end']]).map(([a, z]) => [timeOf(a, meta), timeOf(z, meta)]);
    for (const [a, z] of ranges) if (!(z > a)) throw new Error(`${p.footage}: empty range ${a}..${z}`);
    const speed = p.speed || 1;
    const crop = p.crop ? `crop=${Math.round(p.crop[2] * k)}:${Math.round(p.crop[3] * k)}:${Math.round(p.crop[0] * k)}:${Math.round(p.crop[1] * k)},` : '';
    const vi = inputs.length / 2; inputs.push('-i', src);
    const ci = inputs.length / 2; inputs.push('-i', path.join(work, `cap${i}.png`));
    const segs = ranges.map(([a, z], j) => `[${vi}:v]trim=start=${a.toFixed(3)}:end=${z.toFixed(3)},setpts=(PTS-STARTPTS)/${speed}[p${i}s${j}]`);
    const cat = `${ranges.map((_, j) => `[p${i}s${j}]`).join('')}concat=n=${ranges.length}:v=1:a=0,${crop}scale=${W}:${H}:flags=lanczos,fps=30,setsar=1[p${i}v]`;
    chains.push(...segs, cat, `[p${i}v][${ci}:v]overlay=0:0:format=auto[p${i}]`);
    const secs = ranges.reduce((s, [a, z]) => s + (z - a), 0) / speed;
    total += secs;
    console.log(`  ${String(i + 1).padStart(2)}. ${p.name.padEnd(8)} ${secs.toFixed(1).padStart(5)} s  ${p.caption}`);
  }
  chains.push(`${spec.parts.map((_, i) => `[p${i}]`).join('')}concat=n=${spec.parts.length}:v=1:a=0[tour]`);
  const run = (args, what) => { const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' }); if (r.status !== 0) throw new Error(`ffmpeg failed for ${what}`); };
  const report = (file, budget) => { const kb = Math.round(fs.statSync(file).size / 1024); console.log(`  ${path.relative(ROOT, file).padEnd(40)} ${total.toFixed(1).padStart(5)} s ${String(kb).padStart(6)} KB${budget && kb > budget ? `   OVER the ${budget} KB budget` : ''}`); if (budget && kb > budget) failed = true; };

  if (spec.mp4) {
    const out = path.resolve(ROOT, spec.mp4.to);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    run([...inputs, '-filter_complex', `${chains.join(';')};[tour]scale=${spec.mp4.width || 1280}:-2:flags=lanczos,format=yuv420p[v]`, '-map', '[v]', '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(spec.mp4.crf || 31), '-movflags', '+faststart', '-an', out], 'the tour MP4');
    report(out, spec.mp4.maxKb);
  }
  if (spec.gif) {
    const out = path.resolve(ROOT, spec.gif.to);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const g = spec.gif;
    run([...inputs, '-filter_complex', `${chains.join(';')};[tour]fps=${g.fps || 10},scale=${g.width || 720}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${g.colors || 128}:stats_mode=diff[pal];[b][pal]paletteuse=dither=${g.dither || 'bayer:bayer_scale=4'}:diff_mode=rectangle`, '-loop', '0', out], 'the tour GIF');
    report(out, g.maxKb);
  }
} catch (err) { console.error(`  ${err.message}`); failed = true; } finally { fs.rmSync(work, { recursive: true, force: true }); }
process.exit(failed ? 1 : 0);
