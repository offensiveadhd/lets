# lets SDK: client + shell

Two ES modules, served by the host and usable offline with no build step:

- `/sdk/lets-client.js`: LIP transport (`Lets.connect`, `on`, `emit`, `upload`).
- `/sdk/lets-shell.js` + `/sdk/lets-shell.css`: the **shell**. It provides the companion entity, chat panel, dynamic components, image paste/drop, toasts and the deep-violet theme. It handles every `entity.*`, `chat.*`, `component.*` and `ui.*` command itself, so your unique only handles its own domain (e.g. `graph.*`).

Open `/sdk/demo/` to try the shell on an empty canvas. With no host token it runs on an offline loopback. `window.__shell`, `window.__lets` and `window.__cmd(type, data)` are exposed there for debugging.

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
| `shell.entity` | `show(at?)`, `hide()`, `toggle()`, `say(text \| {text, mood?, ttl?})`, `mood(m)`, `suggest(items, replace?)`, `move({x,y} \| {to})`, `persona(p)`, `onPick(cb)`, `profile()`, `state`, `el` |
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

`entity.summon {x,y,context}` · `entity.dismiss {}` · `entity.click {x,y,context}` · `entity.pick {id,label}` · `entity.profile {pace, clickRate, dwell, regions:{tl,tr,bl,br,c}, idleMs, sessionMs, summons, picks, dismisses}`. Profiles go out at most every 60 s and on unload, are saved to `localStorage['lets.profile']`, and tune the follow spring on the next boot. The shell also emits `chat.message {text, attachments?:[{path,mime}]}` and `component.action {id, action, value?}`. Uploads go through `lets.upload`, and the **host** emits `media.image`.

`entity.say {text, mood?, ttl?}` treats `mood` as temporary: it lasts while the bubble shows. `entity.mood` sets the lasting mood. `chat.say` chunks group by envelope `re` (or `data.re`), can be ordered by `seq`, and end with `done:true`. A message with no `re` and no `seq` is complete on its own. With `ack:true`, invalid commands answer `lip.ack {ok:false, error}`; without it they log a `console.warn`.

## Keyboard & accessibility

| Key | Action |
|---|---|
| Right-click / `Ctrl+Space` | Summon or dismiss the entity |
| `Enter` on the entity | Open its menu (arrow keys move, `Esc` closes) |
| `Ctrl+/` | Toggle chat |
| `Enter` / `Shift+Enter` | Send / new line |
| `Esc` | Close menus and bubbles |

The sprite is `role="button"` with `aria-label="<name>, your companion"`. The chat list is a polite `role="log"`. `prefers-reduced-motion` disables bob and pop animations and makes moves instant.

## CSP

Pages are served with `script-src 'self'`, so keep scripts in files. The shell never uses inline scripts or `eval`. Image previews are painted to `<canvas>`, so they don't depend on `blob:` URLs.
