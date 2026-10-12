# lets SDK: client + shell

Two ES modules, served by the host and usable offline with no build step:

- `/sdk/lets-client.js`: LIP transport (`Lets.connect`, `on`, `emit`, `upload`).
- `/sdk/lets-shell.js` + `/sdk/lets-shell.css`: the **shell**. It provides the companion entity, chat panel, dynamic components, image paste/drop, toasts and the deep-violet theme. It handles every `entity.*`, `chat.*`, `component.*` and `ui.*` command itself, plus the `session.close` farewell, so your unique only handles its own domain (e.g. `graph.*`).

Open `/sdk/demo/` to try the shell on an empty canvas. With no host token it runs on an offline loopback (where `window.close()` is a no-op, so the farewell stays to be tried). The control panel has a button for every mood, reaction and component, and `session.close`. `window.__shell`, `window.__lets` and `window.__cmd(type, data)` are exposed there for debugging.

## Mount

```js
import { Lets } from '/sdk/lets-client.js';
import { Shell } from '/sdk/lets-shell.js';

const lets = Lets.connect({ unique: 'graph', version: '0.1.0', caps: ['entity', 'chat', 'components', 'media.image'] });
const shell = Shell.mount(lets, {
  root: document.body,                       // overlays mount here; right-click is intercepted here
  entity: { name: 'Pip', visible: true },    // defaults; the host's entity.persona overrides them
  context: (info) => ({ selection: [] }),    // info = {reason:'summon'|'click'|'hotkey'|'api', x, y, target?}
  quickSuggestions: (ctx) => [{ id: 'layout', label: 'Auto-layout', hint: 'tree', run: () => layout() }],
  media: true,                               // paste + drop on document (default true)
});
```

The shell injects its own `<link href="/sdk/lets-shell.css">` if it is missing. Add `class="lets-grid-bg"` to any element to get the dotted grid. Return `{handled: true}` from `context()` on a right-click to keep your own context menu there. Local suggestions may carry a `run(item, ctx)` function that runs when the item is picked. `entity.pick` is emitted either way.

## API

| Member | |
|---|---|
| `shell.entity` | `show(at?)`, `hide()`, `toggle()`, `say(text \| {text, mood?, ttl?})`, `mood(m)`, `react(name, {ms?, force?})`, `suggest(items, replace?)`, `move({x,y} \| {to})`, `persona(p)`, `onPick(cb)`, `profile()`, `state`, `el` |
| `shell.chat` | `open()`, `close()`, `toggle(focus?)`, `append(role, text)`, `stream(id, chunk, done)`, `typing(on)`, `attach(file)` |
| `shell.components` | `create(spec)`, `update(id, props)`, `remove(id)`, `get(id)`, `list()`, `register(type, factory)`, `onAction(cb)` |
| `shell.media` | `enablePaste(el = document)`, `enableDrop(el = document)`, `pick()`, `upload(blob, source)` |
| `shell.toast(text, level = 'info', ttl = 3500)` | `info \| ok \| warn \| error`; returns a dismiss function |
| `shell.theme(vars)` | `{accent: '#f0f'}` sets `--lets-accent`; `''` resets it |
| `shell.onInline(cb)` | receives `slot:"inline"` components `{id, type, el, props, update, remove}` to place yourself |
| `shell.onMedia(cb)` | receives every upload `{path, url?, w, h, mime, bytes, source, componentId?, blob}` |
| `shell.destroy()` | unmounts and removes every listener |

`Shell.md(text)` renders markdown-lite (`**bold**`, `*em*`, `` `code` ``, fenced blocks, line breaks) to safe DOM.

## Components

`component.create {id, type, props, slot?, at?}`. Slots: `dock` (default, right stack), `float` (draggable, at `at` or near the entity), `panel` (full-height left), `inline` (goes to `onInline`; falls back to `float` when nobody listens). Every card has a close button, which emits `{action:"close"}` and then removes the card.

| type | props | emits `component.action` |
|---|---|---|
| `note` | `title?, text, tone?` (`ok\|warn\|error\|accent`) | close only |
| `options` | `title?, items:[{id,label,hint?}], multi?, submit?` | `pick` → `id` or `[ids]` |
| `slider` | `title?, min, max, step, value, label?` | `change` → number (150 ms debounce) |
| `toggle` | `title?, value, label?` | `change` → boolean |
| `form` | `title?, fields:[{id,label,type:text\|number\|select\|textarea,options?,value?}], submit?` | `submit` → `{id: value}` |
| `image-drop` | `title?, hint?, multiple?` | `added` → upload path (the host emits `media.image`) |
| `progress` | `title?, value:0-1 (omit for indeterminate), label?` | none |
| `code` | `title?, lang?, code` | `copy` |

Unknown types render as a note showing the props JSON. To add your own type, use `register(type, (ctx) => Element | {el, update(props, patch), destroy()})`. The `ctx` argument is `{id, props, emit(action, value), upload(blob, source), shell}`.

## Events the shell emits (up)

`entity.summon {x,y,context}` · `entity.dismiss {}` · `entity.click {x,y,context}` · `entity.pick {id,label}` · `entity.secret {name}` · `entity.profile {pace, clickRate, dwell, regions:{tl,tr,bl,br,c}, idleMs, sessionMs, summons, picks, dismisses, secrets}`. Profiles go out at most every 60 s and on unload, are saved to `localStorage['lets.profile']`, and tune the follow spring on the next boot. The shell also emits `chat.message {text, attachments?:[{path,mime}]}`, `component.action {id, action, value?}`, and during a farewell `session.closing {reason}` / `session.stay {}`. Uploads go through `lets.upload`, and the **host** emits `media.image`.

`entity.say {text, mood?, ttl?}` treats `mood` as temporary: it lasts while the bubble shows. `entity.mood` sets the lasting mood. `entity.react {name, ms?, force?}` plays a reaction (below). `chat.say` chunks group by envelope `re` (or `data.re`), can be ordered by `seq`, and end with `done:true`. A message with no `re` and no `seq` is complete on its own. With `ack:true`, invalid commands (an unknown mood or reaction name, a missing component) answer `lip.ack {ok:false, error}`; without it they log a `console.warn`.

## Expressions & secret moves

Reactions are short expressions (0.4–2.5 s by default) that never block input. `shell.entity.react(name, {ms?, force?})` and the down-command `entity.react {name, ms?, force?}` play one; `react()` returns `false` for an unknown name or while that reaction cools down (`force` skips the cooldown), and `entity.react` with an unknown name fails its `ack`. `ms` is clamped to 300–8000. One plays at a time: a new one replaces the current one, except the farewell `wave`. Called through the API on a hidden companion, a reaction pops it in first; the gesture triggers below only play while it is visible.

While one plays, the entity layer carries `data-react="<name>"` (a CSS hook for uniques and themes). The look is CSS on extra sprite parts that are hidden the rest of the time (spiral, X, closed and squinting eyes, a grin, a wavy mouth, little arms, a sweat drop, a heart, music notes, confetti, stars, party lights, a night cap). The motion is a WAAPI animation on the sprite's body. With `prefers-reduced-motion` nothing moves or spins: the face, cheeks and glow change for about a second instead.

| name | looks like | plays by itself when | cooldown |
|---|---|---|---|
| `dizzy` | spiral eyes, then x_x, wavy mouth, orbiting stars, wobble | ~1.5 s of very fast pointer travel (median ≥ 2500 px/s); a mouse shake (3 quick reversals within 1 s); circling the companion 2 turns within 3 s (secret) | 8 s |
| `whoa` | wide eyes, "o" mouth, leans back, aura pulse | a wheel or zoom burst (≥ 1500 px of wheel delta in 0.6 s) | 5 s |
| `startled` | wide eyes, little jump, sweat drop | 6 clicks on the unique's surface within 1.5 s | 6 s |
| `gasp` | wide eyes, "o" mouth, hands to cheeks | Delete or Backspace outside a text field | 3 s |
| `oops` | `> <` squint, head tilt, sweat drop | Ctrl+Z / Cmd+Z outside a text field | 3 s |
| `wink` | one eye closes, a twinkle | API only (graph: an edge connected) | 2 s |
| `cheer` | `^ ^`, grin, arms up, two hops, confetti | API only (graph: Send pressed, many nodes added) | 4 s |
| `blush` | glowing cheeks, looks away, tiny wiggle | the pointer rests on the companion for 1.5 s | 20 s |
| `boop` | squish, a heart floats up | a quick click or tap on the companion (the menu still opens); 5 in a row, each within 1.5 s, is the boop streak (secret) | none |
| `yawn` | eyes shut, wide "o", stretch | idle 25–40 s, before it dozes off at 45 s | 60 s |
| `peek` | eyes dart and it leans toward the pointer | the pointer comes back after more than 10 s away (it left the window or the tab was hidden) | 15 s |
| `nod` / `shake-no` | up-down / left-right | API only | 1 s |
| `wave` | `^ ^`, a raised hand, sway | the pointer leaves the window; the `session.close` farewell | 2 s |
| `spin` | a full 360° roll | double-click the companion (secret) | 1 s |
| `dance` | side-to-side groove, music notes | typing `pip` (or the companion's name) outside a text field (secret) | 10 s |
| `disco` | the dance with party lights, 4 s | the Konami code ↑↑↓↓←→←→BA (secret) | 30 s |
| `sparkle` | star burst, little hop | API only (Claude's "proud", a burst of connections) | 4 s |
| `nightcap` | wears a night cap while sleepy | it is sleepy between 00:00 and 05:00 local time (secret) | none |
| `wheee` | squint, grin, bright trail | dragging the caught companion more than 60 px: it follows the pointer directly and lands on release (secret) | none |

The seven secrets are `spin`, `dance`, `disco`, `dizzy` (by circling), `nightcap`, `boop` (the streak) and `wheee`. The first time the human finds one in a window, the shell emits `entity.secret {name}` once, counts it in `entity.profile.secrets`, and the companion says so in a one-line bubble.

## Farewell (`session.close`)

`session.close {reason, text?, ms?}` comes from the host after a handoff ("Send to Claude"), for an idle window, or from Claude (`reason: "handoff" | "idle" | "claude"`). The shell closes the menu and bubble, sets `data-closing="true"` on the shell root (everything dims except the companion and the overlay, and clicks are blocked), moves the companion to the centre, plays `wave`, and shows a `.lets-farewell` glass card with `text` (default "Sent to Claude ✦ see you in Claude Code"), "This window is closing…" and a **Keep working** button. It emits `session.closing {reason}` as the farewell starts and calls `window.close()` after `ms` (default 1400, clamped to 300–8000). Browsers only let a page close a tab it opened itself, so if the page is still visible 350 ms later the card stays and says Claude will close it. **Keep working** (or `Esc`) removes the card, clears `data-closing`, lets the companion follow again, and emits `session.stay {}`.

## Keyboard & accessibility

| Key | Action |
|---|---|
| Right-click / `Ctrl+Space` | Summon or dismiss the entity |
| `Enter` on the entity | Open its menu (arrow keys move, `Esc` closes) |
| `Ctrl+/` | Toggle chat |
| `Enter` / `Shift+Enter` | Send / new line |
| `Esc` | Close menus and bubbles; during a farewell, Keep working |

The sprite is `role="button"` with `aria-label="<name>, your companion"`. The chat list is a polite `role="log"`. `prefers-reduced-motion` disables bob, pop and reaction motion and makes moves instant. The farewell card is a `role="dialog"` whose Keep working button takes focus.

## CSP

Pages are served with `script-src 'self'`, so keep scripts in files. The shell never uses inline scripts or `eval`. Image previews are painted to `<canvas>`, so they don't depend on `blob:` URLs.
