# UI contract: the shell, the companion, and the graph unique

This document is the build contract for the browser side of `lets`. Three
files implement it; they must agree on every name below.

| File | Owner | Purpose |
|---|---|---|
| `sdk/lets-client.js` | engine | LIP transport (done; read it) |
| `sdk/lets-shell.js` + `sdk/lets-shell.css` | engine | the **shell**: companion entity, chat panel, dynamic components, media paste, toasts, theme |
| `uniques/graph/ui/*` | the graph unique | the graph board, using the shell |

Served paths at runtime: `/sdk/lets-client.js`, `/sdk/lets-shell.js`,
`/sdk/lets-shell.css`, `/u/<unique>/…` (the unique's folder). All ES modules,
no bundler, no external CDN. Everything must work offline.

## 1. Theme — "deep violet"

Dark purple. CSS variables on `:root`, defined in `lets-shell.css`:

```css
:root {
  --lets-bg: #120b1f;          /* page */
  --lets-bg-2: #1a1030;        /* panels */
  --lets-bg-3: #241746;        /* cards, nodes */
  --lets-line: #3a2a63;        /* borders, edges */
  --lets-line-2: #5a44a0;      /* hover borders */
  --lets-fg: #ece6ff;          /* text */
  --lets-fg-dim: #a99cd0;      /* secondary text */
  --lets-accent: #a66bff;      /* primary accent (violet) */
  --lets-accent-2: #ff6bd6;    /* magenta accent */
  --lets-accent-3: #6bf0ff;    /* cyan accent, selection glow */
  --lets-ok: #5ef2a6; --lets-warn: #ffd166; --lets-err: #ff6b8b;
  --lets-glow: 0 0 24px rgba(166,107,255,.45);
  --lets-radius: 12px;
  --lets-font: ui-sans-serif, "Segoe UI", Inter, system-ui, sans-serif;
  --lets-mono: ui-monospace, "Cascadia Code", Consolas, monospace;
}
```

Grid background: subtle dotted grid (`radial-gradient` 1px dots, 24px pitch,
color `#2a1b4d`). Everything rounded, soft glows, no harsh white.

## 2. The shell API (`sdk/lets-shell.js`)

```js
import { Lets } from '/sdk/lets-client.js';
import { Shell } from '/sdk/lets-shell.js';

const lets = Lets.connect({ unique: 'graph', version: '0.1.0', caps: ['entity','chat','components','media.image','clipboard'] });
const shell = Shell.mount(lets, {
  root: document.body,            // where overlays mount
  entity: { name: 'Doto' },        // defaults; overridden by `entity.persona`
  context: () => ({ ... }),       // called when the entity is summoned/clicked: unique-specific context
  quickSuggestions: (ctx) => [ {id, label, hint?} ],  // instant local suggestions on entity click
});
```

`Shell.mount` returns an object with:

| Member | Behaviour |
|---|---|
| `shell.entity` | the companion controller (below), including `react(name, {ms?, force?})` |
| `shell.chat` | `open()`, `close()`, `toggle()`, `append(role, text)`, `stream(id, chunk, done)` |
| `shell.components` | `create(spec)`, `update(id, props)`, `remove(id)`, `get(id)`, `register(type, factory)` |
| `shell.toast(text, level='info', ttl=3500)` | bottom-center toasts |
| `shell.media` | `enablePaste(el=document)`, `enableDrop(el)`, `pick()` — all end in `lets.upload()` |
| `shell.theme(vars)` | applies CSS variable overrides |
| `shell.destroy()` | unmount |

The shell **handles these commands itself** (wiring `lets.on(...)`): all of
`entity.*`, `chat.*`, `component.*`, `ui.*`, plus `session.close` and
`session.listening`. The unique never re-implements them.

### 2.1 The companion entity

A floating sprite, ~56px, built from inline SVG: a soft rounded blob/orb with
two expressive eyes, a faint ring, and a little trailing glow. Dark-violet body
with a magenta/cyan rim light. Moods change eye shape, bob speed and glow color:
`idle | happy | curious | thinking | busy | proud | sleepy | alert`.

Behaviour (all client-side, zero network traffic):
- **Summon**: right-click anywhere (the shell intercepts `contextmenu` on `root`
  unless the unique's `context()` returns `{ handled: true }`) toggles the
  entity at the cursor with a pop-in animation. Hotkey `Ctrl+Space` also toggles.
  Emits `entity.summon {x,y,context}` / `entity.dismiss {}`.
- **Follow**: the entity follows the pointer with a critically damped spring
  (no overshoot), keeping a comfortable offset (default 48px right, 36px up),
  with a dead-zone of 24px so micro-movements do not jitter it. Speed adapts to
  the learned `pace` (see profile): faster users get a snappier spring, slower
  users a calmer one. When the pointer is idle 2.5 s the entity drifts into a
  gentle bob and blinks occasionally. It never covers the element under the
  cursor: if the offset would leave the viewport it flips side.
- **Click**: opens a radial/stack menu of suggestions next to the sprite:
  instant local ones from `quickSuggestions(ctx)`, then any `entity.suggest`
  items that arrive (appended, or replacing if `replace:true`). Picking one
  emits `entity.pick {id,label}` and closes the menu. Emits `entity.click`.
- **Say**: `entity.say {text, mood, ttl}` shows a speech bubble anchored to the
  sprite (markdown-lite: `**bold**`, `` `code` ``, line breaks). Auto-hides
  after `ttl` (default 6 s) or on click.
- **Learning**: the shell measures aggregate interaction stats and emits
  `entity.profile` at most every 60 s and on `beforeunload`:
  `{pace: px/s median, clickRate: clicks/min, dwell: median ms between
  actions, regions: {tl,tr,bl,br,c} fractions, idleMs, sessionMs, summons,
  picks, dismisses, secrets}`. It also persists the last profile in `localStorage`
  (`lets.profile`) and tunes its own spring from it on next boot.
- `entity.persona {name, traits:{speed:0-1, distance:0-1, chatty:0-1,
  playful:0-1}, color?}` reconfigures the sprite (name shown on hover).
- `entity.move`, `entity.show`, `entity.hide`, `entity.mood` as in LIP §3.2.
- **Reactions**: short expressions (0.4–2.5 s) that never block input:
  `dizzy whoa startled gasp oops wink cheer blush boop yawn peek nod
  shake-no wave spin dance disco sparkle nightcap wheee`. The shell plays
  most of them from the human's own movement (fast motion or a mouse shake,
  a wheel burst, a click storm, Delete/Backspace and Ctrl+Z outside text
  fields, hovering or clicking the sprite, idling, leaving and coming back;
  the full trigger table is in `sdk/README.md` and `docs/ENTITY.md`).
  `entity.react {name, ms?, force?}` and `shell.entity.react(name, {ms?,
  force?})` play one on demand: `react()` returns `false` for an unknown name
  or during the reaction's cooldown (`force` skips it), and an unknown name
  fails the command's `ack`. `ms` is clamped to 300–8000. One reaction at a
  time; a new one replaces the current one except the farewell `wave`. While
  one plays, `.lets-entity-layer` has `data-react="<name>"`. Motion is WAAPI
  on the sprite (transform/opacity only); under `prefers-reduced-motion` only
  the face, cheeks and glow change, for about a second.
- **Secret moves**: `spin` (double-click), `dance` (type `doto` outside a text
  field), `disco` (Konami code), `dizzy` by circling the sprite twice in 3 s,
  `nightcap` (sleepy between 00:00 and 05:00 local), `boop` (five quick
  clicks in a row) and `wheee` (dragging the caught sprite). The first find
  of each in a window emits `entity.secret {name}` once, adds to
  `entity.profile.secrets`, and shows a one-line bubble.
- **Farewell**: `session.close {reason: "handoff"|"idle"|"claude", text?, ms?}`
  closes the menu and bubble, sets `data-closing="true"` on `.lets-shell`
  (everything dims and stops taking clicks, except the companion and the
  overlay), moves the companion to the centre and plays `wave`, and shows the
  `.lets-farewell` glass card: `text` (default "Sent to Claude ✦ see you in
  Claude Code"), "This window is closing…", and a **Keep working** button
  that takes focus. It emits `session.closing {reason}` when the farewell
  starts and calls `window.close()` after `ms` (default 1400, clamped
  300–8000). If the page is still visible 350 ms later (a tab the page did
  not open cannot close itself), the card stays and says Claude will close
  it. **Keep working** (or `Esc`) removes the card, clears `data-closing`,
  lets the companion follow again, and emits `session.stay {}`.

Accessibility: the sprite has `role="button"`, `aria-label="<name>, your companion"`.
Respect `prefers-reduced-motion` (no bob, instant moves).

### 2.2 Chat panel

Right-docked panel (360px, collapsible to a tab), dark glass. Message list with
`you` / `<entity name>` bubbles, markdown-lite, auto-scroll, streaming cursor
while `chat.say` chunks arrive (`re` groups chunks; `done:true` ends). Input:
textarea, Enter sends (`Shift+Enter` newline), paste of an image uploads it and
attaches `{path,mime}` to the next `chat.message`. Emits `chat.message`.
Keyboard: `Ctrl+/` toggles the panel.

### 2.3 Components

`component.create {id, type, props, slot, at}` renders into:
- `dock` (default): a right-side stack above the chat tab, cards 320px wide.
- `float`: a draggable card at `at` (or near the entity).
- `panel`: full-height left panel.
- `inline`: handed to the unique via `shell.onInline(cb)` so it can place it
  on its own canvas.

Built-in types (props → behaviour, and the `component.action` they emit):

| type | props | emits |
|---|---|---|
| `note` | `{title?, text, tone?}` | — (close button emits `{action:"close"}`) |
| `options` | `{title?, items:[{id,label,hint?}], multi?}` | `{action:"pick", value:id|[ids]}` |
| `slider` | `{title?, min,max,step,value,label?}` | `{action:"change", value}` (debounced 150 ms) |
| `toggle` | `{title?, value, label?}` | `{action:"change", value}` |
| `form` | `{title?, fields:[{id,label,type:"text|number|select|textarea",options?,value?}], submit?}` | `{action:"submit", value:{...}}` |
| `image-drop` | `{title?, hint?, multiple?}` | upload → host emits `media.image`; card shows thumbnails; `{action:"added", value:path}` |
| `progress` | `{title?, value:0-1, label?}` | — |
| `code` | `{title?, lang?, code}` | copy button → `{action:"copy"}` |

Each card: title bar with the type icon, a close "×" (emits `{action:"close"}`
then removes). `component.update` patches props and re-renders in place.
Unknown `type` → render as `note` with the JSON of props in a `<pre>`.

### 2.4 Media

`shell.media.enablePaste()` listens for `paste` with image items anywhere
(unless focus is in a text field that is not the chat), uploads via
`lets.upload(blob, {source:'paste'})`, toasts "image sent to Claude", and
calls `shell.onMedia(cb)` listeners with the result so the unique can place it
(e.g. as an image node). Drag-drop of files does the same with `source:'drop'`.

## 3. Uniques

Each unique keeps its own behaviour spec next to its code (`CONTRACT.md`). The
reference implementation is **graph** — https://github.com/offensiveadhd/lets-unique-graph —
installed by default; its contract covers the board, the `graph.*` events and
commands, and how it uses the shell (`context()`, `quickSuggestions()`,
`onMedia`, `onInline`). **den** — https://github.com/offensiveadhd/lets-unique-den —
is the second default: a scrollable page rather than a canvas, built on the same
shell and the same quality bar below.

## 4. Quality bar
- No console errors; works in Chromium (the app's browser pane) and Edge.
- 60 fps pointer-follow; no layout thrash (transform-only animation).
- Everything keyboard-reachable; `Esc` closes menus/bubbles.
- Files are plain ES modules with JSDoc; no build step.
