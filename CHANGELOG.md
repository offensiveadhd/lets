# Changelog

## Unreleased

- lets-native 0.2.1: a native pane the mod opens from a poll can wait undrawn
  (Claude Code places an unasked pane only when the window is wide enough);
  the mod now toasts when that happens and `/lets-native show` places every
  native pane. `/lets-native` also says where each pane stands (shown, a tab,
  waiting, none). The bare `/lets <args>` alias now really runs
  `/lets:lets <args>`, the plugin's own command, a tick after its own answer
  (the engine refuses a command run or a prompt from inside a command's hook,
  since either would wait on the turn that hook holds; so `/lets graph native`
  printed its forward line and nothing followed). Where that run is refused,
  the skill goes in as a prompt of yours; where the plugin is not installed, a
  toast says how to install it. `/lets` also shows an argument hint.

## 0.7.0 — 2026-10-13

- **Native windows: a unique as a pane inside Claude Code.** A unique can now
  open in two modes. `web` is the browser window it always had. `native` is a
  pane in Claude Code's own sidebar: `/lets graph native` draws the board as an
  SVG picture, a list of your nodes and the inputs for the acts, with Doto as a
  line at the top (his words, his mood, his suggestions as buttons), the chat
  under the view and Claude's runtime components as cards. The pane is drawn by
  the optional **lets-native** mod (`/plugin install lets-native@lets`, or
  `node install.mjs --native`; needs Claude Code 2.1.287+). A manifest opts in
  with `native: {entry, title?, columns?, rows?}`; `entry` (the web page) is now
  optional when `native` is there, so a unique implements one mode or both.
  `/lets <unique> native …` and `/lets <unique> web …` pick the mode (the word
  right after the name); a bare `/lets <unique>` opens the web window when the
  unique has one, else the native one, and `"mode": "native"` in
  `~/.lets/config.json` flips that for uniques that have both. Everything else
  is the same: LIP events and commands, `listen`/`send`/`say`/`query`, the
  prompt hook, sessions (Send to Claude is still a handoff: the pane shows the
  farewell card and closes itself; `resume` brings it back) and the companion.
  graph 0.4.0 is the first unique with a native view; den and cocode stay
  web-only for now. A native window does not outlive the host (a new Claude
  Code session drops it); saved sessions do. Spec: `docs/NATIVE.md`.
- **The native runtime.** A native view is one script (`native.entry`, plain
  JS) that the lets host runs in a `node:vm` context, calling
  `lets.native({init, render, on, action, export, destroy})`. `render` returns a
  tree of elements (Box, Text, Button, Input, Select, Svg, Markdown, Code, Link)
  and the human's presses come back as actions. The context has no `require`,
  `process`, timers, network or file system; handlers are synchronous and
  atomic (one that throws, is stopped after 2 s, or leaves the state over
  1 MB is rolled back); what a view emits per call is bounded (1000 items,
  1 MB); an SVG source is checked before it reaches the pane (no script,
  handlers, character references or external references). This is isolation
  against mistakes, not a security boundary, so install native-capable
  uniques only from authors you trust (`store inspect` marks `native: true`). The mod talks to the host over `GET /lip/native/sync`,
  `POST /lip/native/action`, `POST /lip/native/close`, `POST /lip/native/open`
  and `GET /lip/native/windows` (token-protected like every `/lip/*` route).
  The `open` tool takes `mode: "web"|"native"`; a native result has no `url`
  but `mode`, `windowId`, `title` and `native: {modSeen, howToOpen}` (`modSeen`
  false means no lets-native mod has polled this host yet, so Claude tells you
  to install it or falls back to web). The registry reports `modes` per unique
  (`lets uniques`, `uniques {action:"list"}`, the `open` result), and
  `session.opened` and `session.closed` carry `mode` (`native` for a pane; absent
  means web). CLI: `lets native
  <unique> [--port N]` opens a native window on a running host and prints its
  pane as text, `lets native --w ID --act '{json}'` acts, and `lets serve --open
  graph --mode native`. Manifest schema: `native`.
- Fixes: `query` now arms its cursor before the send, so a reply that arrives
  synchronously (a native view answers inside the send) is no longer missed; the
  host avoids the WHATWG "bad ports" (6000, 6665-6669, 10080, …) that `fetch()`
  and browsers refuse to connect to.
- The lets-native mod is 0.2.0: the native panes, on top of the bare `/lets`
  alias and `/lets-pane`.
- **A local runner, so Run is instant.** A unique that declares
  `permissions.exec` (cocode 0.2.0 does, for python, javascript and
  typescript) can run the program it holds through the engine instead of
  waiting for Claude: `GET /lip/run/info` says what this machine can run and
  how each language is isolated, `POST /lip/run/consent` records the human's
  one-time OK per unique and machine (`~/.lets/config.json` → `runner.allow`),
  and `POST /lip/run` streams the output back as NDJSON in milliseconds. Every
  run gets a fresh job folder under `~/.lets/run/jobs/` (deleted afterwards),
  a scrubbed environment, a 30 s limit (up to 120 s), a 1 MB output cap and a
  process-tree kill. Python runs with `-I -B` under an audit hook that blocks
  files outside the folder, sockets, subprocesses, ctypes and winreg;
  javascript and typescript run under Node's permission model (files confined
  to the folder, no child processes or workers). The host emits
  `session.consent` when the human decides. `"runner": {"enabled": false}`
  switches it off. Spec: `docs/RUNNER.md`.
- **A `run` MCP tool** for Claude: the same sandbox in one call, with the
  output streamed to a window as a command (`emit`, e.g. `cocode.output`), so
  a `cocode.run` no longer costs a file write and a shell call. The `lets`
  skill tells Claude to use it.
- CLI: `lets run <lang> <file|->` and `lets doctor` lists the runner's
  languages. Manifest schema: `permissions.exec`.

## 0.6.0 — 2026-10-13

- **A second default unique: den, Doto's home.** `/lets den` opens the page
  where the human sees everything the companion learned and edits or forgets
  it by pointing: persona (name, tagline, colour), the six traits as sliders,
  likes and dislikes, nicknames, memory lines, special skills (thumbs up or
  down, forget), the seven secret moves (found ones lit) and the interaction
  profile. Every edit goes through Claude (the `entity` tool) and den shows
  it as pending until Claude confirms; Send to Claude hands the page over for
  a memory review in the chat, and "continue" brings it back live.
  `defaults.json` lists it next to graph (repo `lets-unique-den`).
- **Engine for den.** `GET /lip/entity` (token-protected) returns the full
  companion state; the `entity` tool gains `full`, `set` (direct assignment
  of name, tagline, traits, colour), `unlearn` (remove likes, dislikes,
  nickname keys and memory lines by `ts`), `memory` (recent lines with `ts`)
  and `reset` (persona back to defaults, memory kept). `profile.json` now
  records the names of the secret moves found (`secrets`); a found secret is
  written to memory once, under the companion's current name.
- **Fixes.** On a fresh install the persona shared its `traits`, `likes`,
  `dislikes` and `nicknames` objects with the module defaults, so the first
  `learn` in that process changed the defaults too; they are copied now. The
  registry skipped a unique folder that is a symlink or a Windows junction
  (the layout `docs/UNIQUES.md` recommends for development); it follows them
  now. `lets --help` lists `url`, `send`, `events`, `listen` and `defaults`,
  and `lets events` drains its own cursor instead of the one `serve
  --verbose` uses.
- **Template 0.2.0** (`lets-unique-template`): keyboard-accessible dial, the
  session block (Send to Claude, resume) as the reference implementation,
  `package.json`, `scripts/validate.mjs` and CI, README without machine paths.
- Three unique proposals filed for the roadmap: waves, triage, pins.

## 0.5.0 — 2026-10-13

- **Pip is now Doto.** The companion's default name and character changed.
  Doto is *a dot that does* (he/him): short lines, verb first, ending on a
  dot; he does the next thing and then says what he did; he counts things and
  talks less than he does. Default traits are now speed 0.6, distance 0.45,
  chatty 0.4, playful 0.7, formality 0.15, curiosity 0.6, tagline "a dot that
  does". A `persona.json` still named Pip with its default tagline is moved to
  Doto when the engine starts (learned traits, likes and memory are kept and a
  line in `memory.jsonl` says so); a persona the human renamed is left alone.
  Reaction, event and command names are unchanged; the typed secret is now
  d-o-t-o (or his current name) and the dance is "the dot bounce".
- **Shell lines follow him**: greeting ("Hi, I'm Doto. Point at something and
  let's do it."), the farewell ("Sent. See you in Claude Code ✦", bubble
  "Bye."), the empty menu, the secret-found line; a boop gets a short line now
  and then, and the five-boop secret says "Five dots. You're keeping count
  too." The idle bob has a slight roll.
- Docs: `docs/ENTITY.md` carries his character sheet and voice; the skill,
  GUIDE, README, INSTALL, the native pane and the website say Doto.
  `docs/RELEASING.md` is the release checklist.
- The handoff was verified end-to-end in the desktop app browser pane with the
  installed plugin (save, close, answer in chat, resume intact); screenshots
  re-captured against this UI.

## 0.4.0 — 2026-10-12

- **Send to Claude is a handoff.** A unique's *export* event (graph: "Send to
  Claude") is saved as a **session** under `~/.lets/sessions/<unique>/`, the
  event is marked `data.session = {id, handoff: true}` and the window receives
  `session.close`: it says goodbye and closes, and Claude answers in the Claude
  Code chat. `~/.lets/config.json` `"handoff": "stay"` keeps the old behaviour.
- **Resume.** `open {resume: "last" | <id>}` opens a new window with the
  unique's *restore* command queued first, so the board comes back as it was
  sent; `open` lists the recent sessions. New `sessions` tool (list, get,
  label, remove), `state {what:"sessions"}`, CLI `lets sessions`, `/lets graph
  resume`, `/lets sessions`. Manifests declare the roles in a `session` block
  (`export` / `snapshot` / `restore`; defaults `<domain>.export/.snapshot/.load`).
- **Pip has expressions and secret moves** (shell): dizzy when you shake the
  mouse, startled by a click storm, a gasp on Delete, a blush when you hover
  it, a boop when you click it, a yawn before it dozes, a wave when you leave;
  double-click, typing p-i-p, the Konami code, circling it, a boop streak,
  dragging it and a night visit are secrets (`entity.secret`, counted in the
  profile). `entity.react {name}` lets Claude and uniques play them;
  `session.close` plays the farewell.
- Prompt hook and channel messages explain a handoff and point at `resume`.
- `lets doctor` no longer prints host tokens.
- Docs: INSTALL.md (for an agent to run), the copy-paste install prompt,
  CODE_OF_CONDUCT, SECURITY, issue forms, PR template, docs/COMMUNITY.md,
  README rewrite; website at https://tikotiktok.github.io/lets-site/.

## 0.3.0 — 2026-10-10

- **Uniques are separate repositories.** `graph` moved to
  https://github.com/TikoTikTok/lets-unique-graph (history preserved); the
  engine ships no unique.
- **Default uniques.** `defaults.json` lists the mediums every install gets;
  the engine clones missing ones into `~/.lets/uniques` on first start, on
  demand when `open` names one, via `lets defaults`, and from `install.mjs`.
  `LETS_NO_DEFAULTS=1` opts out. `uniques {action:"defaults"}` tool action.
- `LETS_UNIQUES_DIRS` (path-separated) adds folders to the registry for
  developing uniques anywhere.
- Tests run against a bundled fixture unique (`tests/fixtures/uniques/mini`).
- Store index: graph points at its repo; pulse (template) listed.

## 0.2.0 — 2026-10-10

Fixes from the first real session on the graph board.

- **Chat / Send to Claude / Ask now get answers.** Events always reached the
  host, but nothing woke Claude. The `/lets` skill now runs an *attentive
  loop* (`listen {wait_ms: 90000}` repeatedly while a window is connected),
  the window shows whether Pip is **listening** (green dot in the chat header
  and on the sprite) or **away** (your message is delivered with your next
  Claude Code prompt), and the engine exposes `session.listening`.
- **Channel support.** The MCP server declares `claude/channel`; when Claude
  Code loads it as a channel (CLI `--channels` / development channels), window
  events wake Claude directly. Inert otherwise.
- **Pip never blocks a drag.** The sprite is click-through unless you reach
  for it slowly (or its menu is open), and it steps further aside while you
  drag anything on the board.
- **Pip keeps a little more distance** from the pointer (66 × 50 px base).
- **Selection-aware questions.** Pip's click menu now asks about what you
  selected or hovered: explain, what's missing, what comes next, break it into
  steps, critique, better name; on empty space: what do you see, suggest a
  structure, review the flow. Each becomes a `graph.ask` with ids and labels.
- CLI: `lets listen`, `lets send`, `lets events`, `lets url` for driving a host
  by hand; `/lip/listen` and `/lip/command` endpoints.
- Host resolves unique assets against the entry folder, rescans uniques added
  after start, serves uploads at `/uploads/…` so image nodes render.

## 0.1.0 — 2026-10-09

First release: engine, LIP v1, graph unique, companion shell, store, template,
native mod, installer.
