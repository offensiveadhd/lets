#!/usr/bin/env node
/**
 * Install lets into this machine's Claude Code.
 *
 *   node install.mjs                 # marketplace from GitHub (TikoTikTok/lets) + plugin + bare /lets alias
 *   node install.mjs --local         # marketplace from THIS checkout (edits are picked up on reinstall/update)
 *   node install.mjs --native        # also install the optional lets-native mod (/lets + /lets-pane; Claude Code 2.1.287+)
 *   node install.mjs --no-skill      # skip the personal /lets alias skill
 *   node install.mjs --uninstall     # remove plugin(s), marketplace and the alias skill
 *
 * Needs: node >= 18, the `claude` CLI on PATH, and (for the GitHub source) git
 * credentials that can read the private repo (`gh auth setup-git`).
 * Nothing here touches ~/.lets (the companion's memory survives reinstalls).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const MARKETPLACE = 'lets';
const GITHUB = 'TikoTikTok/lets';
const source = args.has('--local') ? root : GITHUB;
const claude = process.platform === 'win32' ? 'claude.cmd' : 'claude';

const q = (s) => (/^[A-Za-z0-9_@=:./\\-]+$/.test(s) ? s : `"${String(s).replace(/"/g, '\\"')}"`);

function run(cmd, argv, { ok = () => true, quiet = false } = {}) {
  // `claude` is a .cmd shim on Windows, so it needs a shell; pass one quoted command line (no args array) to stay warning-free
  const r = process.platform === 'win32'
    ? spawnSync(`${cmd} ${argv.map(q).join(' ')}`, { encoding: 'utf8', shell: true })
    : spawnSync(cmd, argv, { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (!quiet) console.log(`$ ${cmd} ${argv.join(' ')}\n${out.split('\n').map((l) => '  ' + l).join('\n')}`);
  return { status: r.status, out, ok: r.status === 0 || ok(out) };
}

function step(title) { console.log(`\n== ${title}`); }

const have = run(claude, ['--version'], { quiet: true });
if (have.status !== 0) { console.error('claude CLI not found on PATH. Install Claude Code first: https://code.claude.com'); process.exit(1); }
console.log(`claude ${have.out}`);

if (args.has('--uninstall')) {
  step('uninstall');
  run(claude, ['plugin', 'uninstall', `lets-native@${MARKETPLACE}`], { ok: (o) => /not installed|not found/i.test(o) });
  run(claude, ['plugin', 'uninstall', `lets@${MARKETPLACE}`], { ok: (o) => /not installed|not found/i.test(o) });
  run(claude, ['plugin', 'marketplace', 'remove', MARKETPLACE], { ok: (o) => /not found|unknown/i.test(o) });
  const skill = path.join(os.homedir(), '.claude', 'skills', 'lets');
  fs.rmSync(skill, { recursive: true, force: true });
  console.log(`removed ${skill}`);
  process.exit(0);
}

step(`marketplace "${MARKETPLACE}" from ${source}`);
const added = run(claude, ['plugin', 'marketplace', 'add', source], { ok: (o) => /already/i.test(o) });
if (!added.ok) {
  console.error('\nCould not add the marketplace. For the private GitHub source run `gh auth setup-git` first, or use `node install.mjs --local`.');
  process.exit(1);
}
if (/already/i.test(added.out)) run(claude, ['plugin', 'marketplace', 'update', MARKETPLACE], { ok: () => true });

step('plugin lets');
const inst = run(claude, ['plugin', 'install', `lets@${MARKETPLACE}`, '--scope', 'user'], { ok: (o) => /already installed/i.test(o) });
if (!inst.ok) { console.error('\nplugin install failed'); process.exit(1); }
if (/already installed/i.test(inst.out)) run(claude, ['plugin', 'update', `lets@${MARKETPLACE}`], { ok: () => true });

if (args.has('--native')) {
  step('plugin lets-native (optional mod)');
  run(claude, ['plugin', 'install', `lets-native@${MARKETPLACE}`, '--scope', 'user'], { ok: (o) => /already installed/i.test(o) });
}

if (!args.has('--no-skill') && !args.has('--native')) {
  step('personal /lets alias skill');
  const r = spawnSync(process.execPath, [path.join(root, 'engine', 'bin', 'lets.mjs'), 'install-skill'], { encoding: 'utf8' });
  console.log(`  ${(r.stdout || r.stderr || '').trim()}`);
} else if (args.has('--native')) {
  console.log('\n(skipping the personal /lets alias: lets-native provides /lets itself)');
}

step('default uniques (graph, …)');
{
  const r = spawnSync(process.execPath, [path.join(root, 'engine', 'bin', 'lets.mjs'), 'defaults'], { encoding: 'utf8' });
  console.log((r.stdout || r.stderr || '').trim().split('\n').map((l) => '  ' + l).join('\n'));
  if (r.status !== 0) console.log('  (could not install a default unique now; the engine retries on first use — needs git and access to the repo)');
}

step('verify');
run(claude, ['plugin', 'list'], { ok: () => true });

console.log(`
Done. In any Claude Code session (restart the app or run /reload-plugins):
  /lets:lets graph            open the graph board
  /lets graph                 same, through the alias${args.has('--native') ? ' (lets-native)' : ''}
  /lets:lets entity           meet the companion
State lives in ~/.lets. Update later with:  claude plugin update lets@${MARKETPLACE}
`);
