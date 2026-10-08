#!/usr/bin/env node
/**
 * UserPromptSubmit hook: when the human sends a prompt, pull any window events
 * that happened since the last prompt from every live lets host and print them
 * as context. Silent and fast when there is nothing. Never fails the prompt.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = process.env.LETS_HOME || path.join(os.homedir(), '.lets');
const RUN = path.join(HOME, 'run');
const deadline = Date.now() + 1500;

async function main() {
  let files = [];
  try { files = fs.readdirSync(RUN).filter((f) => f.startsWith('host-') && f.endsWith('.json')); } catch { return; }
  const blocks = [];
  for (const f of files) {
    const file = path.join(RUN, f);
    let run;
    try { run = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    if (!run?.port || !run?.token) continue;
    const base = `http://127.0.0.1:${run.port}`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), Math.max(200, deadline - Date.now()));
    try {
      const res = await fetch(`${base}/lip/drain?cursor=hook&max=40`, { headers: { 'x-lets-token': run.token }, signal: ctl.signal });
      if (!res.ok) continue;
      const r = await res.json();
      const open = (r.windows || []).filter((w) => w.connected);
      if (!r.events?.length) continue;
      const lines = r.events.map((e) => {
        const d = JSON.stringify(e.data ?? {});
        return `- ${e.type} (${String(e.from).replace(/^unique:/, '')}) ${d.length > 600 ? d.slice(0, 600) + '…' : d}`;
      });
      blocks.push(`[lets] ${r.events.length} window event(s) since your last prompt (${open.length} window(s) open on ${base}):\n${lines.join('\n')}\nReact per the unique's guide; use the lets tools (send/say/query) to answer in the window.`);
    } catch (err) {
      // stale run file: host gone
      if (err?.cause?.code === 'ECONNREFUSED') { try { fs.unlinkSync(file); } catch { /* ignore */ } }
    } finally { clearTimeout(t); }
  }
  if (blocks.length) process.stdout.write(blocks.join('\n\n') + '\n');
}

main().catch(() => {}).finally(() => process.exit(0));
