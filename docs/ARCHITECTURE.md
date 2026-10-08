# Architecture

```
┌──────────────┐   MCP (stdio)   ┌───────────────────────┐   SSE ↓ / POST ↑   ┌──────────────────┐
│ Claude Code  │ ◄─────────────► │  lets engine (Node)   │ ◄────────────────► │ Browser window   │
│  /lets skill │   10 tools      │  host · bus · entity  │   loopback + token │  unique + shell  │
│  prompt hook │ ──GET /drain──► │  router · store       │                    │  companion       │
└──────────────┘                 └───────────────────────┘                    └──────────────────┘
                                          │
                                   ~/.lets/ (state)
```

## Pieces

**engine/src/mcp.mjs** — JSON-RPC 2.0 over newline-delimited stdio. `initialize`,
`tools/list`, `tools/call`, `ping`. No SDK: the plugin installs with zero
`npm install`.

**engine/src/host.mjs** — `http.Server` bound to 127.0.0.1 on a free port.
Routes: `/u/<unique>/…` (static, CSP), `/sdk/…`, `/uploads/…`, `/lip/stream`
(SSE down), `/lip/event` (POST up), `/lip/upload` (blobs → disk → `media.*`
event with a path), `/lip/drain` (named cursor read for hooks), `/lip/persona`.
A run file `~/.lets/run/host-<pid>.json` publishes port + token for the hook.

**engine/src/bus.mjs** — one ring buffer of up-events with named cursors
(`claude`, `hook`, ad-hoc query cursors), long-poll waiters, per-window SSE
client sets with pending queues (commands sent before the window connects are
delivered on attach, unless their `ttl` expired), ack tracking, and coalescing
of chatty types (`graph.changed`, `entity.profile`) that no reader has seen.

**engine/src/registry.mjs** — discovers uniques in `uniques/` (bundled),
`~/.lets/uniques` (installed), `<project>/.lets/uniques` (local), validates
`unique.json` against `protocol/schemas/unique.schema.json` plus the safety
rules (entry inside folder, no reserved domains, declared domains only).

**engine/src/entity.mjs** — persona + profile + memory + skills on disk.
`brief()` is what Claude sees on every `open` (kept small on purpose).
`absorbProfile()` folds the shell's aggregate stats into the learned profile
and nudges the persona's traits. `teach()` writes a special skill.

**engine/src/router.mjs** — kind priors → complexity/risk → tier; a ledger of
outcomes per `(kind, tier)` bumps tiers with poor trust and allows safe
demotions; `plan()` builds topological waves for parallel Agent spawns.

**engine/src/store.mjs** — git stores (`index.json`) → `inspect` (clone to
staging, validate, hash check, executable scan) → `install` (copy to
`~/.lets/uniques/<name>`, record sha). Only after a human confirms.

**sdk/lets-client.js** — the browser transport. **sdk/lets-shell.js** — the
companion, chat, components, media, toasts.

**hooks/drain.mjs** — `UserPromptSubmit`: pulls the `hook` cursor from every
live host and prints the events as context. Window events therefore reach
Claude with the human's next message at zero tool-call cost.

## Why these choices

- **Browser window, not a native pane.** The Claude Code mod API draws a
  constrained element tree; a graph board with a flying companion, clipboard
  paste and drag needs a real DOM. The app's built-in browser pane makes it
  feel native anyway.
- **SSE + POST, not WebSocket.** Zero dependencies, trivially debuggable,
  works through any proxy, and the engine must install from git with no build.
- **Events are semantic.** Pointer moves never cross to the model; the shell
  turns behaviour into aggregates (`entity.profile`). Tokens are spent on
  meaning.
- **Static uniques.** Community mediums are HTML/JS served under CSP from
  loopback with a per-host token. The host runs none of their code. The
  manifest declares domains, capabilities and permissions up front, and the
  store pins commits and manifest hashes.
- **The guide is data.** Each unique ships `GUIDE.md`; the engine hands it to
  Claude on `open`. New mediums teach Claude how to behave without changing
  the engine or the skill.
- **The companion is persistent and honest.** Learning is explicit (`learn`,
  `teach`, `reinforce`) and inspectable on disk; nothing is "learned" that the
  model did not write down.

## Lifecycle of `/lets graph`

1. The skill calls `open` → the engine registers a window id, mints the URL
   (`/u/graph/#w=…&t=…`), returns guide + entity brief.
2. Claude opens the URL in the browser pane. The page loads `lets-client.js`,
   connects SSE, receives `lip.hello` and `entity.persona`, emits `lip.ready`.
3. The human draws. The board emits `graph.*`; the shell emits `entity.*`,
   `chat.*`, `component.*`, `media.*`.
4. On the human's next prompt the hook drains those events into context, or
   Claude calls `listen`/`query` explicitly.
5. Claude reacts with `send`/`say`: nodes appear animated, the companion
   speaks, a component card shows up.
6. Before leaving, Claude writes what it learned (`entity learn/teach`).

## Future mediums

A unique may be anything the LIP envelope can carry. A voice ring would emit
`chat.message` from transcription and `entity.summon` on a wake word; an AR
overlay would emit `component.action` from gestures. The shell contract
(entity/chat/components/media) is the stable surface; the engine, the skill
and the store need no change for a new medium.
