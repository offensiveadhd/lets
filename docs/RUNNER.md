# The runner: running a program on this machine, fast and with consent

New in lets **0.7.0**. A unique such as cocode can execute the program it holds
without a round trip through Claude: the human presses **Run**, the window
asks the engine, the engine runs the code in a sandboxed subprocess and streams
the output back in milliseconds. Claude gets a matching MCP tool (`run`) so
that when it does run something itself, it is one call instead of several.

Nothing runs until the human says so, per machine and per unique, and what runs
is always the code the human can see.

## 1 Who may run what

| Path | Who decides | Gate |
|---|---|---|
| `POST /lip/run` (a window) | the human, by pressing Run in the window | the unique's manifest declares `permissions.exec` for that language **and** the human allowed that unique on this machine (`~/.lets/config.json` → `runner.allow`) |
| `run` MCP tool (Claude) | Claude, inside Claude Code | Claude Code's own permission prompt for the tool; no manifest or consent needed, because Claude can already run code with its shell tool |

Consent is asked once, in the window, the first time it wants to run: the
engine answers `403 {error:"consent"}`, the window shows what will happen and
a button, and `POST /lip/run/consent {allow:true}` records the decision:

```jsonc
// ~/.lets/config.json
{ "handoff": "close", "runner": { "allow": { "cocode": true }, "timeoutMs": 30000 } }
```

Set `"runner": {"enabled": false}` to switch the whole feature off (the
endpoints answer `403 {error:"disabled"}` and the tool refuses).

## 2 What the sandbox is, honestly

The engine runs the program as **you**, on your machine, in a fresh job folder
under `~/.lets/run/jobs/<id>/` that is deleted afterwards. The process gets a
scrubbed environment (`PATH`, the system variables a runtime needs, `HOME`,
`TEMP` and `TMPDIR` pointing at the job folder, UTF-8 forced, `NO_COLOR`), the
job folder as its working directory, an empty or given stdin, a **30 s** limit
(configurable up to 120 s), a **1 MB** output cap, and its whole process tree
is killed when a limit is hit. On top of that, per language:

| language | runtime | isolation | what it stops |
|---|---|---|---|
| `python` | `python` 3.8+ with `-I -B` | **audit hook** (`sys.addaudithook`, installed before the program runs; a program may add its own observer hooks but cannot remove or precede this one). The policy is default-deny: only a known list of harmless events passes | file access outside the job folder (reads of the Python installation itself are allowed), every socket operation and the standard library's network clients, subprocesses in every form (`subprocess`, `os.system`/`exec*`/`spawn*`/`fork`, `posix_spawn`, `pty`, `_winapi.CreateProcess`), `ctypes`, `winreg`, dll loading, sqlite extensions, and the import of `ctypes`, `multiprocessing`, `pty` and `webbrowser` (modules compiled into the interpreter, such as `socket`, `subprocess`, `winreg` or `_winapi`, can be imported but not used). A blocked call raises `RuntimeError: blocked by the lets sandbox: <event>` in the program |
| `javascript` | `node` 20+ with the permission model (`--permission` or `--experimental-permission`) | **Node permission model** | file access outside the job folder, child processes, worker threads, native addons. Network is **not** restricted by Node's model |
| `typescript` | the same, with `--experimental-strip-types` (Node 22.6+) | the same | the same |

Other languages (`bash`, `go`, …) are not run by the engine; they still go
through Claude. `GET /lip/run/info` reports exactly which languages are
available on this machine and which isolation each gets, and the window shows
it next to the Run button.

What this does not do: it is not a VM. CPU and memory are not capped (only
time and output), the Node path does not block the network or the
`node:inspector` module (a loopback debug port), and the kill after a limit
is by process id, so a process that has already exited is never targeted but
a grandchild that detached itself could survive. Treat it as "running a script
you can read, with the sharp edges filed off", which is what pressing Run on
code you wrote or asked for means. Containers (Docker) are the planned next
isolation level; the response's `sandbox` field names the level that was
used, so windows and Claude can say so. The sandbox was reviewed
adversarially before release (`_winapi.CreateProcess` was the one escape
found, and is why the Python policy is default-deny).

## 3 Endpoints (token required, like every `/lip/*`)

### `GET /lip/run/info?w=<windowId>`

```jsonc
{
  "enabled": true,                        // the feature (config.runner.enabled !== false)
  "allowed": false,                       // consent for this window's unique on this machine
  "unique": "cocode",
  "exec": ["python", "javascript"],       // what the manifest declares
  "languages": {                          // what this machine can run, and how
    "python":     { "ok": true,  "version": "3.14.2", "sandbox": "audit-hook" },
    "javascript": { "ok": true,  "version": "24.15.0", "sandbox": "node-permission" },
    "typescript": { "ok": true,  "version": "24.15.0", "sandbox": "node-permission" }
  },
  "limits": { "timeoutMs": 30000, "maxTimeoutMs": 120000, "outputBytes": 1048576, "concurrent": 2 }
}
```

### `POST /lip/run/consent?w=<windowId>` body `{"allow": true}`

Records consent for the window's unique (`{"allow": false}` revokes it).
Answers `{"allowed": true}`.

### `POST /lip/run?w=<windowId>` body `{"lang", "code", "stdin"?, "timeoutMs"?, "run"?}`

Checks, in order: feature enabled; the window exists; its manifest lists `lang`
in `permissions.exec`; consent; the language is available; fewer than
`concurrent` runs in flight (else `429`). Then it answers **200
`application/x-ndjson`** and streams one JSON object per line:

```jsonc
{"run":"r_84_1","stream":"system","text":"python main.py (audit-hook sandbox)\n"}
{"run":"r_84_1","stream":"stdout","text":"- .... .. ...\n"}
{"run":"r_84_1","stream":"stderr","text":"…"}
{"run":"r_84_1","done":true,"exit":0,"ms":412,"timedOut":false,"killed":null,"sandbox":"audit-hook","bytes":2240}
```

`killed` is `null`, `"timeout"` or `"output"`. `exit` is `null` when the process
was killed. `bytes` is the total output the program produced (stdout and
stderr). The `run` id is echoed from the request (or made up by the engine).
`timeoutMs` in the request is clamped to 1 000…120 000 ms; without it the
configured `runner.timeoutMs` (default 30 000) applies. `concurrent` (2) and
the output cap are fixed.

Failures before the process starts are plain JSON `{"error", "message"}`:

| status | `error` | when |
|---|---|---|
| 400 | `bad-request` | bad JSON, empty code, code over 2 MB, unknown window |
| 403 | `disabled` | `runner.enabled` is `false` |
| 403 | `not-declared` | the unique's manifest has no `permissions.exec` for that language |
| 403 | `consent` | the human has not allowed this unique on this machine |
| 409 | `unavailable` | the language's runtime is missing or too old (the message says why) |
| 429 | `busy` | two runs are already in flight |

A failure after the stream started (rare) ends it with a `done:true` line that
carries `error` and `message` instead of `exit`.

## 4 The `run` MCP tool (Claude)

```jsonc
run {lang:"python", code:"print(1)", stdin?, timeout_ms?, to?:"<windowId>", emit?:"cocode.output", run?:"r_84_1"}
→ {exit:0, ms:40, timedOut:false, killed:null, sandbox:"audit-hook", stdout:"1\n", stderr:"", bytes:2}
```

With `emit` and `to`, every chunk is also sent to that window as a command of
that type with `{run, stream, text, seq}`, and the last one carries `done:true,
exit, ms` — the shape cocode's `cocode.output` expects. `stdout` and `stderr`
in the result are the last 8 000 characters. The tool accepts the same three
languages as the endpoint (`python`, `javascript`, `typescript`); anything
else is for Claude's own shell tool, with its own permission prompt. It
ignores the per-unique consent (Claude Code's prompt for the tool is the
gate) but respects `runner.enabled`.

The host also emits `session.consent {windowId, unique, runner:true|false}`
as an up-event when the human allows or revokes a unique, so Claude knows.

## 5 Manifest

```jsonc
"permissions": { "fs.write": [], "net": [], "exec": ["python", "javascript", "typescript"] }
```

`exec` lists the languages the unique may ask the engine to run on the
human's behalf. The store's inspect step shows it like every other permission.
A unique without `exec` cannot use `/lip/run` at all.

## 6 CLI

```bash
lets run python ./script.py              # run a file through the sandbox and print the output
lets run javascript - < snippet.js       # from stdin
lets doctor                              # shows runner languages and their isolation
```

## 7 Why not run in the browser

Pages are served with `script-src 'self'` and no `unsafe-eval`, so a unique
cannot `eval` or spin up a worker from a blob; running Python in the page would
need a 10 MB WebAssembly runtime vendored into every unique. The engine is
already a trusted local process, so the sandbox lives there.
