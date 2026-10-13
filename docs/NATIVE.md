# Native windows: a unique as a pane inside Claude Code

Since 0.7.0 a unique can open in two ways:

| Mode | Where it draws | Who runs the unique's code |
|---|---|---|
| `web` (the way since 0.1.0) | the app's browser pane (or any browser) | the browser, from the unique's `entry` page |
| `native` (0.7.0) | a pane in Claude Code's own sidebar, drawn by the **lets-native** mod | the lets host, from the unique's `native.entry` script, inside a `node:vm` context |

`/lets <unique> web …` and `/lets <unique> native …` pick the mode; a bare
`/lets <unique>` opens the web window when the unique has one, else the
native one (`~/.lets/config.json` `"mode": "native"` flips the preference for
uniques that have both). A unique implements one mode or both: the manifest
says which.

Everything else is unchanged. A native window is a LIP window like any other:
it has a window id, it emits the same events (`graph.node.select`,
`graph.export`, `chat.message`, …) and it receives the same commands
(`graph.node.add`, `entity.say`, `chat.say`, `component.create`, …). Claude's
tools (`listen`, `send`, `say`, `query`), the prompt hook, sessions (handoff
and resume) and the companion work the same. Only the surface differs: a
sidebar pane has no pointer canvas, no clipboard image paste and no sprite, so
a native view is a *second interface* to the same medium, built from the
elements Claude Code draws (boxes, text, buttons, inputs, selects, SVG,
markdown, code).

## 1. Manifest

```jsonc
{
  "lip": 1,
  "name": "graph",
  "entry": "ui/index.html",          // web mode (optional since 0.7.0)
  "native": {                         // native mode (optional)
    "entry": "native/index.js",       // one script, inside the unique folder, .js or .mjs
    "title": "graph",                 // pane title; default: the manifest title
    "columns": 56,                    // pane width wanted when docked (cells); default 56
    "rows": 40                        // pane height wanted when inline; default 40
  },
  …
}
```

At least one of `entry` and `native` is required. The registry reports the
`modes` a unique supports (`["web"]`, `["native"]` or both); `lets uniques`,
`uniques {action:"list"}`, the `open` result and the store's `inspect` show
them (`inspect` also says `native: true`, because that unique runs in the
host: §8).

## 2. The native view script

`native.entry` is one plain script (not an ES module: no `import`/`export`),
evaluated once per native window inside its own `node:vm` context. It sees
the JavaScript builtins, a `console` that writes to the host log, and one
global, `lets`. It calls `lets.native({...})` exactly once:

```js
lets.native({
  // Required. The initial state, plain JSON. ctx (below) carries the window's facts.
  init(ctx) { return { nodes: [], edges: [], selection: [] }; },

  // Required. State → tree (section 3). Pure: it may be called at any time.
  render(state, ui, ctx) { return ui.col({ gap: 1 }, ui.text({ bold: true }, 'graph'), …); },

  // Commands from Claude (down). One handler per type, or '*' for the rest.
  // Mutate `state` in place, or return a new state. Throw to refuse (the
  // thrower's message reaches Claude as lip.error, or as a failed ack).
  on: {
    'graph.node.add'(state, data, ctx) { … },
    'graph.snapshot'(state, data, ctx) { ctx.reply('graph.snapshot', { graph: state.graph }); },
  },

  // What the human did in the pane (section 4): a press, an Enter, a pick.
  action(state, act, ctx) { if (act.key === 'add' && act.kind === 'submit') … },

  // Optional. The payload of "Send to Claude" (the shell draws the button;
  // the host saves it as a session and closes the window: the handoff).
  export(state) { return { graph: state.graph }; },

  // Optional. Called when the window closes; last chance to ctx.emit.
  destroy(state, ctx) {},
});
```

`ctx` (the same object for the window's life):

| Member | Meaning |
|---|---|
| `ctx.unique`, `ctx.windowId`, `ctx.version` | the window's facts |
| `ctx.native` | the view API version this host speaks (`1`) |
| `ctx.args` | the `args` the `open` tool passed (e.g. `{intent: "…"}`) |
| `ctx.persona` | the companion as `entity.persona` carries it: `{name, traits, color}` |
| `ctx.viewport` | `{cols, rows}` of *this* pane as last drawn (0 before the first draw) |
| `ctx.emit(type, data)` | send an up-event (`type` must start with one of the unique's domains) |
| `ctx.reply(type, data)` | like `emit`, with `re` set to the command being handled (for snapshot answers) |
| `ctx.toast(text, level?)` | a toast in the pane (`info`, `ok`, `warn`, `error`) |
| `ctx.chat(text)` | echo a line of the human's into the pane's chat (what the web shell does with an *Ask*); no event |
| `ctx.after(ms)` | ask for one redraw after `ms` (100–60000) without a command: how a highlight or a hint expires (one pending per window; the view checks `ctx.now()` in `render`) |
| `ctx.id(prefix)` | a short random id (`n_k3f9a`) |
| `ctx.now()` | `Date.now()` |

Rules the host enforces:

- Every function is **synchronous**. A handler that returns a Promise (an
  `async` function) is refused with an error.
- Handlers are **atomic**: a command or action handler runs against a
  snapshot, and when it throws, is stopped, or leaves the state over the
  limit, the state is put back as it was before the call and the events it
  had queued are discarded (its toasts and logs still go out).
- `render` is pure: it reads the state and returns a tree. The one call it
  may make is `ctx.after(ms)`, to re-arm the next expiry it sees, since the
  host keeps one pending redraw per window (the earliest).
- A call runs for at most 2 s; a handler that never returns is stopped, and
  the error reaches Claude.
- The state, and anything a function returns (a tree, an export payload),
  must be plain JSON under 1 MB; functions, cycles and anything larger are
  refused.
- `emit`/`reply`/`toast`/`chat`/`after`/`console` go through a queue the
  host drains after the call: at most 1000 items and 1 MB in all per call;
  the rest are dropped and counted in the host log. `emit` types must belong
  to the unique's domains (shell-domain events are the shell's: see §5),
  with one exception: a view may raise `lip.error {code, message}` for a
  partial result, as the web board does; the host adds `re` while a command
  is being handled.
- An error in `init` refuses the open: the `open` tool reports it and no
  window exists. An error in `render` or in a handler is logged and shown in
  the pane; the window stays open so the author and Claude can see it.

## 3. Trees

`render` returns a tree of plain nodes: `{ t, p, c }` (`t` the element, `p`
its props, `c` its children) or a string. `ui` builds them:

```js
ui.box(props, ...children)        // {t:'Box'}      layout: flexDirection, gap, padding, borderStyle, width, …
ui.row(props, ...children)        // Box with flexDirection:'row'
ui.col(props, ...children)        // Box with flexDirection:'column'
ui.text(props, ...children)       // {t:'Text'}     color, dimColor, bold, italic, underline, wrap, …; ui.text('plain') works too
ui.button({ key, label, variant, dimColor, plain })      // a press → action {key, kind:'press'}
ui.input({ key, label, placeholder, value, submitLabel }) // Enter → action {key, kind:'submit', value}
ui.select({ key, label, options:[{value,label}], value }) // a pick → action {key, kind:'select', value}
ui.svg({ source, alt, width, height, isInteractive })    // an <svg> document, at most 120000 characters
ui.markdown(text, { dimColor })
ui.code({ source, language, startLine, wrap })
ui.link({ href, label })
```

The element set is the desktop surface's (Claude Code's `ui.render` API):
`Box, Text, Button, Input, Select, Svg, Markdown, Code, Link`. Props are
whitelisted per element (numbers where the element wants numbers: an SVG's
`width`/`height`, a Code's `startLine`, a Box's gaps and margins); unknown
props are dropped, unknown elements become their `alt` or label as dim
text. On a surface without `Svg` (the terminal) an SVG draws as its `alt`
text; on one without `Input`/`Select` (mobile) they draw as text. Keys
(`key`) are the unique's own; the host namespaces them, so `add` in your
tree is never confused with the shell's buttons. A Button without a `label`
takes its children's text; one without a `key` is addressed by its label; a
Button cannot be disabled (draw it `dimColor` and ignore the press). An
Input's `value` is what the field shows at each redraw (every change of the
state redraws), and the person's typing replaces it until the next redraw.

**SVG.** The source is checked, not trusted: it must be one `<svg>…</svg>`
document with no `<script>`, `<foreignObject>` or other foreign content, no
event-handler attributes (also none set through SMIL `attributeName`), no
character references (`&#…;`, named entities other than `&amp; &lt; &gt;
&quot; &apos;`), no doctype or entity declarations, and every `href`,
`xlink:href`, `src` or `url()` pointing inside the document (`#id`) or at
inline image data (`data:image/…`). The checks read the markup and its
attributes, not the text of a `<text>` element (a label may say
`data: users`), unless the document holds a `<style>` block, which is text
the renderer obeys: then everything is scanned. A source that fails is
drawn as its `alt` plus the reason. Gradients, markers, `<use href="#id">`
and `fill="url(#g)"` all work; escape `&`, `<` and `>` in labels as
`&amp;`, `&lt;` and `&gt;`.

Bounds: 5000 nodes, depth 24, 96 KB serialized (the SVG source counts). A
tree over a bound is replaced by an error line naming it.

Sizing: `ctx.viewport.cols` is this pane's width in character cells (about
8 px each on the desktop; 0 before the pane was drawn once). For an SVG,
draw into a `viewBox` and pass `width: Math.min(Math.max(ctx.viewport.cols, 30) * 8, 720)`
plus the matching `height`.

## 4. Actions

An `action` is what the human did on one of the view's own elements:

```js
{ key: 'add', kind: 'submit', value: 'Validate input' }   // Input, Enter
{ key: 'sel:n_ab12c', kind: 'press' }                        // Button
{ key: 'kind', kind: 'select', value: 'decision' }           // Select
```

`action(state, act, ctx)` runs with the state, mutates it (or returns a new
one) and emits whatever the act means (`ctx.emit('graph.node.create', …)`).
The host re-renders after every action and after every command, and the
pane redraws from the new tree (immediately for the human's own action; at
the next poll, about a second, for a command from Claude).

## 5. The native shell

What the browser shell (`sdk/lets-shell.js`) gives every web unique, the
host's native shell gives every native view, drawn around the view's tree:

| Part | Drawn as | Commands | Events |
|---|---|---|---|
| Companion | `◉ Doto · mood` on the first row, his latest line beneath it, a glyph for `entity.react` | `entity.say`, `entity.mood`, `entity.persona`, `entity.react`, `entity.suggest` (items as buttons; a press → `entity.pick`) | `entity.pick {id, label}`, `entity.profile` at close (counts and rhythm only: `pace`, `regions`, `summons`, `secrets` are 0, `native: true`, `actions` is the count) |
| Chat | the last 8 lines (`you` / `<name>`) and an input, under the view; `chat.open` shows it, `chat.close` hides it | `chat.open`, `chat.close`, `chat.say` (streams by `re`, `done`; 16 open streams at most), `chat.typing` | `chat.message {text}` |
| Components | cards after the view: `note`, `options` (buttons), `toggle` (one button), `progress` (a bar), `code`, `form` (one input per field, a submit button), `slider` (an input: type a number, Enter sets it); `image-drop` falls back to a note saying so | `component.create`, `component.update`, `component.remove` | `component.action {id, action, value}` (`pick`, `change`, `submit`, `close`, `copy`) |
| Toasts | up to three lines at the bottom, newest last; each fades after about eight seconds | `ui.toast` | — |
| Send to Claude | a primary button on the first row when the view has `export()` | — | the manifest's `session.export` type with the payload |
| Listening | `listening` / `away` beside the companion | `session.listening` | — |
| Farewell | the view is replaced by a card: the text, "Keep working" | `session.close {reason, text?, ms?}` (`ms` is raised to at least 2.5 s so the card survives a poll) | `session.closing`, then the pane closes (`session.closed`); "Keep working" → `session.stay` |

Ids of suggestions, components and form fields are reduced to
`[A-Za-z0-9_.-]`. `entity.move`, `entity.show`, `entity.hide`, `ui.theme` and
`lip.ping` are accepted and do nothing. A `lip.ack` is sent for every command
flagged `ack: true` (`ok: false` with the handler's message when it threw);
an unflagged failure is a `lip.error {code, message, re}`.

## 6. Transport: the lets-native mod ↔ the host

The mod (`mods/lets-native`, a Claude Code function-hooks plugin) is the
display. It never runs unique code: it reads trees and posts actions.

| Leg | Mechanism |
|---|---|
| mod → host (poll) | `GET /lip/native/sync?known=<w>:<rev>,…&v=<w>:<cols>x<rows>,…` → `{ windows: [{ id, unique, title, columns, rows, rev, closed?, tree? }], listening }`. Header `x-lets-native: <mod version>`; the host remembers when it last saw one (`open` reports it, so Claude can tell the human to install the mod). `tree` comes only where `rev` moved past `known`; `v` gives each pane's own size (`cols`/`rows` are a fallback for every window). A closed window is listed until the poller has seen it (its id in `known`) or ten seconds passed, then dropped. Polled every ~1.2 s while a native window is open, every ~3.6 s otherwise. |
| mod → host (act) | `POST /lip/native/action?w=<id>` `{ key, kind, value? }` → `{ ok, rev, tree, error? }` (the new tree, so the human's own action redraws at once) |
| mod → host (close) | `POST /lip/native/close?w=<id>` `{ reason }` (the person closed the pane) |
| Claude → host | the `open` tool with `mode: "native"` creates the window; `send`/`say`/`query`/`listen` are unchanged |
| hooks, CLI | `POST /lip/native/open` `{ unique, args?, windowId? }` → `{ windowId }`; `lets native <unique>` opens one and prints its tree as text (it sends no `x-lets-native`, so it never passes for the mod) |

All `/lip/native/*` endpoints need the host token like every `/lip/*` route;
window ids are reduced to `[A-Za-z0-9_-]{1,32}`. Inside Claude Code the mod
opens one pane per native window (`$.ui.open`, id `lets-<windowId>`, the
manifest's `native.title`, `columns`), draws its tree with `ui.render`,
closes it when the host says `closed`, and tells the host when the person
closes it. A `tool.call` hook on the `open` tool makes the pane appear right
after Claude opened the window, without waiting for a poll.

The mod learns which hosts are *its session's* from the `open` results it
sees (a machine runs one host per Claude Code session); until it has seen
one it syncs every live host.

## 7. Lifecycle

1. `/lets graph native plan the auth flow` → the skill calls
   `open {unique:"graph", mode:"native", args:{intent}}`.
2. The host loads `native/index.js` into a fresh context, calls `init`,
   attaches the window to the bus (queued commands, a restore on `resume`,
   are delivered now), pushes `session.opened` and `lip.ready`. A view that
   fails to load leaves nothing behind.
3. The mod's next sync (or its `tool.call` hook) sees the new window and
   opens the pane; `render` runs and the tree is drawn.
4. The human presses and types in the pane → actions → the view emits events
   → Claude reads them with `listen` or the prompt hook, as always.
5. Claude `send`s commands → the view's handlers run → the pane redraws at
   the next poll. Companion lines, chat and components are drawn by the
   native shell.
6. **Send to Claude** → the view's `export()` payload goes out as the
   export event → the host saves the session and sends `session.close` →
   the shell shows the farewell card → the pane closes itself; Claude
   answers in the transcript. `open {mode:"native", resume:"last"}` brings
   it back: the restore command is the first thing the new view handles.
7. The person closes the pane → `session.closed`; the host drops the
   context. A host restart (a new Claude Code session) drops native windows
   too: unlike a browser tab they do not outlive the host. Sessions (what
   was sent to Claude) do.

## 8. Security

A web unique never runs in the host: it is static files behind CSP. A
native view **does** run in the host process, inside a `node:vm` context
with no `require`, no `process`, no timers, no network and no file system:
the only door is the `lets` object, and handlers are stopped after 2 s. That
is isolation against mistakes, not a sandbox against hostile code: `node:vm`
is not a security boundary, and a view that wants to escape it can.

So the rule for a native-capable unique is the rule SECURITY.md already
gives for guides and events, made stronger: install one only from an author
you trust, as you would an editor extension. The store's `inspect` marks
`native: true` and says so before the human confirms; the defaults
(`defaults.json`) are trusted by that list. A unique with only a web entry
runs nothing in the host, as before.

## 9. Authoring checklist

- `native/index.js`: one script, `lets.native({...})`, state as JSON,
  synchronous functions only.
- Handle every command you declare in `commands`, including the restore
  command (`graph.load`) with `session.resumed` first in its data.
- Emit the events you declare, with the same shapes as the web view, so the
  `GUIDE.md` holds for both modes. Say in the guide what differs natively
  (no pointer, what the controls are).
- Keep trees small: a list of the human's things with a button each, inputs
  for the acts, one SVG for the picture.
- `lets validate <dir>` checks the manifest; `lets native <name>` on a
  running host shows the tree; `tests/native.test.mjs` in the engine is the
  reference for driving a view headlessly.
