// Starts an engine in-process, pushes a window event, then runs hooks/drain.mjs
// the way Claude Code's UserPromptSubmit hook would, and checks it prints the event.
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.LETS_HOME = process.env.LETS_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'lets-hook-'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createEngine } = await import('../engine/src/engine.mjs');
const engine = await createEngine({ log: () => {} });
const { windowId } = engine.host.windowUrl('graph');
engine.host.bus.push({ lip: 1, id: 'ev_HOOKTEST000000', ts: Date.now(), dir: 'up', from: `unique:graph#${windowId}`, type: 'graph.ask', data: { question: 'why?', selection: ['n1'] } });

// async spawn: the host lives in this process, so its event loop must keep running
function runHook() {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(root, 'hooks', 'drain.mjs')], { env: { ...process.env } });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const r = await runHook();
const ok1 = r.status === 0 && r.stdout.includes('graph.ask') && r.stdout.includes('why?');
console.log(ok1 ? 'ok   hook prints pending events' : `FAIL hook output: status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
const r2 = await runHook();
const ok2 = r2.status === 0 && r2.stdout.trim() === '';
console.log(ok2 ? 'ok   hook is silent when nothing is pending' : `FAIL second run printed: ${r2.stdout}`);
engine.stop();
process.exit(ok1 && ok2 ? 0 : 1);
