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
```

Rules: `name` is lowercase kebab (`^[a-z][a-z0-9-]{1,31}$`); `entry`, `guide`,
`icon` stay inside the folder; your `domains` are yours (`lip`, `session`,
`entity`, `chat`, `component`, `media`, `ui` are reserved); every event and
command you declare starts with one of your domains. Validate with
`node engine/bin/lets.mjs validate ./my-unique`.

## 2. Manifest

See [protocol/LIP.md §6](../protocol/LIP.md). Keep `summary` lines short — they
are shown to Claude on `open`. Declare `capabilities` honestly (the shell only
enables paste/upload when `media.image` or `clipboard` is listed) and
`permissions` (`fs.write: ["uploads"]` is the only write a unique can ask for).

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
components on your canvas, `shell.toast()` for feedback.

Theme: use the CSS variables in `/sdk/lets-shell.css` (`--lets-bg`,
`--lets-accent`, …) so your unique matches the companion.

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

The reference implementation is **graph** (https://github.com/TikoTikTok/lets-unique-graph):
read its `CONTRACT.md`, `GUIDE.md` and `ui/graph.js` to see every part of the
contract in use. Uniques listed in the engine's `defaults.json` are installed for
everyone on first use; propose one there once it is solid.

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
