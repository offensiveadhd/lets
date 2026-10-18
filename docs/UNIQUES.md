# Authoring a unique

A unique is a static web app plus a manifest plus a guide. The engine serves it,
the shell gives it a companion, chat and components, and LIP carries what the
human does to Claude and what Claude decides back.

## 1. Folder

```
my-unique/
  unique.json        manifest (required)
  GUIDE.md           instructions for Claude (strongly recommended)
  icon.svg           64×64
  schemas/*.json     optional JSON Schemas for your events/commands
  ui/index.html      entry (declared in the manifest)
  ui/app.js
  ui/style.css
  native/index.js    native view (optional, 0.7.0; see §3b)
```

Rules: `name` is lowercase kebab (`^[a-z][a-z0-9-]{1,31}$`); `entry`, `native.entry`,
`guide`, `icon` stay inside the folder; your `domains` are yours (`lip`, `session`,
`entity`, `chat`, `component`, `media`, `ui` are reserved); every event and
command you declare starts with one of your domains. Validate with
`node engine/bin/lets.mjs validate ./my-unique`.

## 2. Manifest

See [protocol/LIP.md §6](../protocol/LIP.md). Keep `summary` lines short — they
are shown to Claude on `open`. Declare `capabilities` honestly (the shell only
enables paste/upload when `media.image` or `clipboard` is listed) and
`permissions` (`fs.write: ["uploads"]` is the only write a unique can ask for).
`permissions.exec` lists the languages the unique may ask the engine to run
(`["python", "javascript", "typescript"]`, for example). A unique without it
cannot use `/lip/run`; see §3 and [RUNNER.md](RUNNER.md).
`native` (optional, 0.7.0) declares a native view; at least one of `entry` and
`native` is required, so a unique opens in the browser, in a Claude Code pane,
or both. See §3b.

## 3. UI

```html
<body data-unique="my-unique">
<link rel="stylesheet" href="/sdk/lets-shell.css">
<script type="module" src="./app.js"></script>
```

```js
import { Lets } from '/sdk/lets-client.js';
import { Shell } from '/sdk/lets-shell.js';

const lets = Lets.connect({ unique: 'my-unique', version: '0.1.0', caps: ['entity', 'chat', 'components'] });
const shell = Shell.mount(lets, {
  root: document.body,
  context: () => ({ /* what the companion should know when summoned/clicked */ }),
  quickSuggestions: (ctx) => [{ id: 'help', label: 'What can I do here?' }],
});

lets.on('my-unique.thing.set', (data) => { /* a command from Claude */ });
button.onclick = () => lets.emit('my-unique.thing.changed', { value });
```

The shell handles `entity.*`, `chat.*`, `component.*`, `ui.*` for you. Use
`shell.onMedia(cb)` to place pasted images, `shell.onInline(cb)` to place inline
components on your canvas, `shell.toast()` for feedback. Read-only host state
is one call away: `await lets.get('/lip/persona')` or `await lets.get('/lip/entity')`.

Theme: use the CSS variables in `/sdk/lets-shell.css` (`--lets-bg`,
`--lets-accent`, …) so your unique matches the companion.

Running code (0.7.0). A unique that holds a program can run it on the human's
machine without a round trip through Claude. Declare the languages in
`permissions.exec`. When the human presses Run, call
`await lets.get('/lip/run/info?w=' + lets.windowId)`: it says whether the runner
is `enabled`, whether the human `allowed` your unique, and which `languages` this
machine can run and with which `sandbox`. If `allowed` is false, show what will
happen and a button, and `POST /lip/run/consent?w=…` with `{"allow": true}` when
the human presses it (a run without consent answers `403 {error:"consent"}`).
Then `POST /lip/run?w=…` with `{lang, code, stdin?, timeoutMs?, run?}`, using
`fetch` with the same `x-lets-token` header, and read the response as an NDJSON
stream: one JSON object per line (`stream` is `system`, `stdout` or `stderr`),
ended by a line with `done:true, exit, ms, timedOut, killed, sandbox`. Show the
sandbox level next to the Run button. The contract is in [RUNNER.md](RUNNER.md),
and **cocode** is the unique to read for a working example.

## 3b. Native mode (optional)

Since 0.7.0 a unique can also open as a pane inside Claude Code, drawn by the
optional lets-native mod. It is a second interface to the same medium: the
same events, the same commands, the same guide. Declare it in the manifest:

```jsonc
"native": { "entry": "native/index.js", "title": "graph", "columns": 56, "rows": 40 }
```

`entry` (the web page) becomes optional once `native` is there. The registry
reports the `modes` a unique supports (`web`, `native` or both), and `/lets
<unique>` opens the web window when there is one, else the native one;
`/lets <unique> native` and `/lets <unique> web` choose.

The view is **one plain script** (not an ES module) that the lets host runs in a
`node:vm` context. It calls `lets.native({init, render, on, action, export,
destroy})` once: `render(state, ui, ctx)` returns a tree of `Box`, `Text`,
`Button`, `Input`, `Select`, `Svg`, `Markdown`, `Code` and `Link`; `on` has one
handler per command from Claude; `action(state, act, ctx)` gets what the human
pressed, entered or picked and emits your events with `ctx.emit`. Handle the
restore command from your `session` block, and emit events with the same shapes
as the web view, so one `GUIDE.md` covers both modes (say in it what differs: no
pointer, what the controls are). The companion line, chat, components, toasts,
Send to Claude and the farewell card are drawn for you by the native shell, as
the browser shell does for a web unique. Keep trees small: a list of the human's
things with a button each, inputs for the acts, one SVG for the picture.

To try it, run a host (`lets serve --open my-unique --mode native`), then
`lets native my-unique --port N` opens a native window and prints its pane as
text, and `lets native --w ID --act '{"key":"add","kind":"submit","value":"x"}'`
presses a control. `tests/native.test.mjs` shows how to drive a view headlessly.
The full contract (the context API, the trees, the actions, the transport, the
limits) is [NATIVE.md](NATIVE.md).

Trust. A native view runs in the host process, not in a browser: its context has
no `require`, `process`, timers, network or file system, and a handler is stopped
after 2 s, but `node:vm` is isolation against mistakes and not a security
boundary. People should install a unique with a native view only from an author
they trust; the store's `inspect` marks `native: true` so they see it first.
Ask for nothing the view does not need, and keep the script plain enough to
read in one sitting. A unique with only a web `entry` runs nothing in the host.

## 4. Guide

`GUIDE.md` is read by Claude once per open. Write it for a smart colleague:

- one line per event: what it means and what to do;
- the commands with tiny JSON examples;
- etiquette: animate, do not rearrange what the human made, keep labels short;
- the companion's role in this medium.

Under ~1,200 words. It is the most important file you write.

## 5. Develop

```bash
# option a: any folder — point the registry at the PARENT of your unique folders
LETS_UNIQUES_DIRS=/path/to/parent node engine/bin/lets.mjs serve --open my-unique --verbose
# option b: project-local
mkdir -p .lets/uniques && ln -s /path/to/my-unique .lets/uniques/my-unique
# option c: user-wide (where defaults and store installs live)
cp -r my-unique ~/.lets/uniques/
```

The reference implementation is **graph** (https://github.com/offensiveadhd/lets-unique-graph):
read its `CONTRACT.md`, `GUIDE.md` and `ui/graph.js` to see every part of the
contract in use. **den** (https://github.com/offensiveadhd/lets-unique-den, Doto's
home) is the other default and the one to read for a page-style unique: it
fetches host state with `lets.get('/lip/entity')`, applies the human's edits
optimistically and marks them pending until Claude confirms. **cocode** (https://github.com/offensiveadhd/lets-unique-cocode) is a store unique
to read for an editor-style window: a textarea over a highlighted layer, ghost
suggestions streamed from Claude, a build-ahead pane and a handoff that carries
runs and annotations. Uniques listed in
the engine's `defaults.json` (graph and den today) are installed for everyone on
first use; propose one there once it is solid.

`--verbose` prints every up-event; use the companion's chat to simulate
Claude, or run the real thing: `claude --plugin-dir /path/to/lets` then
`/lets:lets my-unique`.

## 6. Share

Push the folder (or a repo containing it) to GitHub, then open a PR to
**lets-store** adding an index entry: `name`, `repo`, `path`, `ref`, ideally a
pinned `sha` and `manifestSha256`. Users run `/lets store my-unique`, see the
inspection (permissions, problems, verified flag), confirm, and it lands in
`~/.lets/uniques/my-unique`.

## 7. Design for the future

Think in *acts*, not widgets. Your events should say what the human meant
(`timeline.span.set`, not `mouse.drag`). Your commands should be idempotent and
animatable. If your medium has no pointer (voice, gesture, AR), you still emit
`entity.summon`, `component.action` and `media.*` — the shell for that medium
decides how those feel.
