/**
 * The runner: executes a program on this machine for a unique (after the
 * human allowed it) or for Claude (the `run` tool), in a sandboxed subprocess.
 * Spec: docs/RUNNER.md.
 *
 *   - a fresh job folder under ~/.lets/run/jobs/<id>/ (cwd, HOME, TEMP), deleted afterwards
 *   - a scrubbed environment, UTF-8 forced, no NODE_OPTIONS / PYTHON* leaks
 *   - python: `-I -B` plus an audit hook (engine/src/sandbox/python_guard.py) that blocks
 *     files outside the job folder, sockets, subprocesses, ctypes, winreg
 *   - javascript / typescript: node's permission model, fs confined to the job folder,
 *     no child processes, no workers (network is not covered by that model)
 *   - a time limit (default 30 s, max 120 s), an output cap (1 MB), the process tree killed
 *
 * Zero dependencies. Nothing here decides *whether* to run: the host checks the
 * manifest and the consent, the MCP tool trusts Claude Code's own permission prompt.
 */
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { DIRS, readJson, writeJson } from './paths.mjs';
import { rid } from './ids.mjs';

export const LIMITS = { timeoutMs: 30_000, maxTimeoutMs: 120_000, outputBytes: 1_048_576, concurrent: 2 };
export const LANGS = ['python', 'javascript', 'typescript'];
const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sandbox', 'python_guard.py');
const WIN = process.platform === 'win32';
const ESM = /^\s*(import\s[\s\S]*?from\s|import\s+['"]|export\s)/m;

const clampInt = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.floor(+v))) : d);
const flags = process.allowedNodeEnvironmentFlags;
const PERMISSION_FLAG = flags.has('--permission') ? '--permission' : flags.has('--experimental-permission') ? '--experimental-permission' : null;
const STRIP_TYPES = flags.has('--experimental-strip-types');
const DETECT_MODULE = flags.has('--experimental-detect-module');

/** Run a command with a short timeout; resolves {ok, stdout} and never throws. */
function tryExec(cmd, args, ms = 5000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: ms, windowsHide: true, env: scrubEnv(process.cwd()) }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '').trim() }));
    } catch { resolve({ ok: false, stdout: '' }); }
  });
}

/** The environment a job sees: the system essentials, UTF-8, every "home" pointed at the job folder. */
export function scrubEnv(job) {
  const e = process.env;
  const out = {
    PATH: e.PATH || e.Path || '',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TERM: 'dumb', NO_COLOR: '1', LETS_SANDBOX: '1',
    HOME: job, USERPROFILE: job, TMPDIR: job, TEMP: job, TMP: job,
    PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
  };
  if (WIN) for (const k of ['SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'ComSpec', 'PATHEXT', 'WINDIR', 'SYSTEMDRIVE', 'SystemDrive', 'PROGRAMDATA', 'LOCALAPPDATA']) if (e[k]) out[k] = e[k];
  return out;
}

/** Probe the runtimes this machine has. Cached by the Runner for its lifetime. */
async function probe() {
  const out = {};
  // python: the first of python / python3 / py -3 that is 3.8+ and answers in isolated mode
  out.python = { ok: false, sandbox: 'audit-hook', reason: 'python 3.8+ not found on PATH' };
  for (const [cmd, pre] of [['python', []], ['python3', []], ['py', ['-3']]]) {
    const r = await tryExec(cmd, [...pre, '-I', '-c', 'import sys; print(sys.version_info[0], sys.version_info[1], sys.version.split()[0])']);
    const m = r.ok && r.stdout.match(/^(\d+) (\d+) (\S+)/);
    if (m && (+m[1] > 3 || (+m[1] === 3 && +m[2] >= 8))) { out.python = { ok: true, cmd, args: [...pre, '-I', '-B'], version: m[3], sandbox: 'audit-hook' }; break; }
  }
  if (out.python.ok && !fs.existsSync(GUARD)) out.python = { ok: false, sandbox: 'audit-hook', reason: 'python_guard.py missing' };
  // node: this process's own binary, with the permission model
  const node = process.version.replace(/^v/, '');
  if (PERMISSION_FLAG) {
    out.javascript = { ok: true, cmd: process.execPath, version: node, sandbox: 'node-permission' };
    out.typescript = STRIP_TYPES ? { ok: true, cmd: process.execPath, version: node, sandbox: 'node-permission' } : { ok: false, sandbox: 'node-permission', reason: 'node 22.6+ (type stripping) is required' };
  } else {
    out.javascript = { ok: false, sandbox: 'node-permission', reason: 'node 20+ with the permission model is required' };
    out.typescript = { ok: false, sandbox: 'node-permission', reason: 'node 22.6+ with the permission model is required' };
  }
  return out;
}

/** Kill a process and everything it spawned (only while it is still ours: a reused pid is never targeted). */
function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  } catch { /* already gone */ }
}

export class Runner {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.inFlight = 0;
    this._probe = null;
  }

  /** `~/.lets/config.json` → `runner`. */
  config() {
    const cfg = readJson(path.join(DIRS.home, 'config.json'), {}) || {};
    const r = cfg.runner && typeof cfg.runner === 'object' ? cfg.runner : {};
    const allow = r.allow && typeof r.allow === 'object' ? r.allow : {};
    return { enabled: r.enabled !== false, allow, timeoutMs: clampInt(r.timeoutMs, 1000, LIMITS.maxTimeoutMs, LIMITS.timeoutMs) };
  }
  get enabled() { return this.config().enabled; }
  allowed(unique) { return this.config().allow[unique] === true; }
  /** Record (or revoke) the human's consent for a unique on this machine. */
  setAllowed(unique, allow) {
    const file = path.join(DIRS.home, 'config.json');
    const cfg = readJson(file, {}) || {};
    const r = cfg.runner && typeof cfg.runner === 'object' ? cfg.runner : {};
    const map = { ...(r.allow && typeof r.allow === 'object' ? r.allow : {}) };
    if (allow) map[unique] = true; else delete map[unique];
    cfg.runner = { ...r, allow: map };
    writeJson(file, cfg);
    this.log('runner', `${allow ? 'allowed' : 'revoked'} ${unique}`);
    return !!allow;
  }

  /** The languages this machine can run and how each is isolated (probed once). */
  languages() {
    if (!this._probe) this._probe = probe().catch((err) => { this._probe = null; throw err; });
    return this._probe;
  }

  /** What a window gets from GET /lip/run/info. */
  async info(unique, manifest) {
    const langs = await this.languages();
    const pub = Object.fromEntries(Object.entries(langs).map(([k, v]) => [k, { ok: v.ok, version: v.version, sandbox: v.sandbox, ...(v.reason ? { reason: v.reason } : {}) }]));
    const cfg = this.config();
    return {
      enabled: cfg.enabled, allowed: cfg.enabled && this.allowed(unique), unique,
      exec: execList(manifest), languages: pub,
      limits: { timeoutMs: cfg.timeoutMs, maxTimeoutMs: LIMITS.maxTimeoutMs, outputBytes: LIMITS.outputBytes, concurrent: LIMITS.concurrent },
    };
  }

  /**
   * Run `code` as `lang`. `onChunk({stream, text})` streams output as it comes.
   * Resolves {run, exit, ms, timedOut, killed, sandbox, bytes}; rejects with
   * {code: 'unavailable' | 'busy' | 'bad-request', message} before anything starts.
   */
  async run({ lang, code, stdin = '', timeoutMs, run = rid('r'), onChunk = () => {} }) {
    if (!LANGS.includes(lang)) throw fail('bad-request', `unknown language "${lang}" (${LANGS.join(', ')})`);
    if (typeof code !== 'string' || !code.trim()) throw fail('bad-request', 'code is empty');
    if (code.length > 2_000_000) throw fail('bad-request', 'code is too large (2 MB max)');
    const langs = await this.languages();
    const L = langs[lang];
    if (!L?.ok) throw fail('unavailable', `${lang}: ${L?.reason || 'not available on this machine'}`);
    if (this.inFlight >= LIMITS.concurrent) throw fail('busy', `${LIMITS.concurrent} runs are already in flight`);
    const limit = clampInt(timeoutMs, 1000, LIMITS.maxTimeoutMs, this.config().timeoutMs);

    const job = path.join(DIRS.run, 'jobs', rid('j').slice(2, 16));
    fs.mkdirSync(job, { recursive: true });
    let argv;
    let file;
    if (lang === 'python') {
      file = 'main.py';
      fs.copyFileSync(GUARD, path.join(job, '_lets_guard.py'));
      argv = [L.cmd, ...L.args, '_lets_guard.py', file];
    } else {
      const esm = ESM.test(code);
      file = lang === 'typescript' ? (esm ? 'main.mts' : 'main.ts') : (esm ? 'main.mjs' : 'main.cjs');
      // one prefix entry per flag: a directory with its trailing separator covers everything inside it on
      // Node 20 through 24 (the "<dir>/*" form crashes Node 20 on Linux with an internal assertion)
      argv = [L.cmd, PERMISSION_FLAG, `--allow-fs-read=${job}${path.sep}`, `--allow-fs-write=${job}${path.sep}`];
      if (lang === 'typescript') argv.push('--experimental-strip-types');
      if (DETECT_MODULE) argv.push('--experimental-detect-module');
      argv.push('--no-warnings', file);
    }
    fs.writeFileSync(path.join(job, file), code, 'utf8');

    this.inFlight++;
    const t0 = Date.now();
    const result = { run, exit: null, ms: 0, timedOut: false, killed: null, sandbox: L.sandbox, bytes: 0 };
    this.log('runner', `run ${run}: ${lang} (${L.sandbox}), ${code.length} chars, ${limit} ms`);
    try {
      onChunk({ stream: 'system', text: `${path.basename(argv[0])} ${file} (${L.sandbox} sandbox)\n` });
      await new Promise((resolve) => {
        let child;
        try {
          child = spawn(argv[0], argv.slice(1), { cwd: job, env: scrubEnv(job), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !WIN });
        } catch (err) {
          onChunk({ stream: 'stderr', text: `could not start ${argv[0]}: ${err.message}\n` });
          result.exit = 127;
          return resolve();
        }
        const dec = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
        let done = false;
        const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
        const stop = (why) => { if (result.killed || done) return; result.killed = why; if (why === 'timeout') result.timedOut = true; killTree(child); };
        const timer = setTimeout(() => stop('timeout'), limit);
        let capped = false;
        const pipe = (stream) => (buf) => {
          if (capped) return;
          // the cap is enforced before anything is forwarded: at most outputBytes ever reach the client
          const room = LIMITS.outputBytes - result.bytes;
          const slice = buf.length > room ? buf.subarray(0, Math.max(0, room)) : buf;
          result.bytes += slice.length;
          const text = dec[stream].write(slice).replace(/\r\n/g, '\n');   // Windows runtimes print CRLF
          if (text) onChunk({ stream, text });
          if (buf.length > room) {
            capped = true;
            child.stdout.pause(); child.stderr.pause();                  // the pipe fills and the program blocks until it is killed
            onChunk({ stream: 'system', text: `\n[output cap ${LIMITS.outputBytes} bytes reached; stopped]\n` });
            stop('output');
          }
        };
        child.stdout.on('data', pipe('stdout'));
        child.stderr.on('data', pipe('stderr'));
        child.on('error', (err) => { onChunk({ stream: 'stderr', text: `could not start ${argv[0]}: ${err.message}\n` }); result.exit = 127; finish(); });
        child.on('close', (code) => {
          for (const s of ['stdout', 'stderr']) { const rest = dec[s].end(); if (rest) onChunk({ stream: s, text: rest }); }
          result.exit = result.killed ? null : code;
          if (result.killed === 'timeout') onChunk({ stream: 'system', text: `\n[killed after ${limit} ms]\n` });
          finish();
        });
        try { child.stdin.on('error', () => {}); child.stdin.end(String(stdin || '')); } catch { /* ignore */ }
      });
    } finally {
      this.inFlight--;
      result.ms = Date.now() - t0;
      cleanup(job);
    }
    this.log('runner', `run ${run}: exit ${result.exit}${result.killed ? ` (${result.killed})` : ''} in ${result.ms} ms, ${result.bytes} bytes`);
    return result;
  }
}

/** The languages a manifest lets a window run (permissions.exec). */
export function execList(manifest) {
  const list = manifest?.permissions?.exec;
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
}

function fail(code, message) { const e = new Error(message); e.code = code; return e; }

/** Remove a job folder; a killed child on Windows may hold a handle for a moment, so retry once. */
function cleanup(job) {
  const rm = () => fs.rmSync(job, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  try { rm(); } catch { setTimeout(() => { try { rm(); } catch { /* leave it; jobs/ is scratch */ } }, 800).unref?.(); }
}
