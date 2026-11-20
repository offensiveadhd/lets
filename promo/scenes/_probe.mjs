// A look at a window before writing its scene: opens it, saves a PNG, lists the controls.
//   node promo/scenes/_probe.mjs graph [seconds-to-record]
import { stage, sleep } from '../lib/rig.mjs';

const unique = process.argv[2] || 'graph';
const seconds = Number(process.argv[3] || 0);
const s = await stage({ unique, name: `_probe-${unique}`, debugPort: Number(process.env.PROMO_DEBUG_PORT) || 9399 });
console.log('window', s.windowId, s.url.replace(/t=[^&]+/, 't=…'));
await sleep(1200);
await s.shot(`probe-${unique}.png`);
const controls = await s.b.eval(`[...document.querySelectorAll('button, input, select, textarea, [role=button], [contenteditable]')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '')) + '  "' + (e.getAttribute('aria-label') || e.title || e.textContent || e.placeholder || '').trim().slice(0, 40) + '"  @' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); }).join('\\n')`);
console.log(controls);
if (seconds) {
  await s.rec.start();
  for (let i = 0; i < seconds; i++) { await s.b.glide(200 + Math.random() * 880, 120 + Math.random() * 480, 800); await sleep(200); }
  await s.end();
} else { s.claude?.stop(); await s.b.close(); await s.host.stop(); }
process.exit(0);
