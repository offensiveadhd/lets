# lets-native

The Claude Code side of `lets`: a **mod** (Claude Code function-hooks plugin,
2.1.287+) that lives inside the Claude Code terminal or the desktop app's Code
tab. Optional: `lets` works without it (browser windows), and with it a unique
can also open as a **pane in Claude Code's own sidebar**.

| Command | Does |
|---|---|
| `/lets <args>` | bare alias → submits `/lets:lets <args>` as a prompt of yours, so the skill runs at once (`/lets graph`, `/lets graph native`) |
| `/lets-pane` | opens a live pane: running hosts, open windows, the companion's name + mood, the latest window events |
| `/lets-native [show\|sync]` | lists the native windows this session shows and where each pane stands; `show` places their panes (a pane the mod opened from a poll may wait undrawn until the person asks for it or the window is wide enough; the mod toasts when that happens); `sync` polls the hosts now |
| *(no command)* | **native panes**: every native window a lets host holds gets a pane here, drawn from the tree the host renders (docs/NATIVE.md) |

## Native panes

`/lets graph native` asks the lets engine for a native window of `graph`. The
host runs the unique's `native/index.js` in a vm context and renders it to a
tree of plain nodes (boxes, text, buttons, inputs, selects, an SVG picture,
markdown, code). This mod:

1. polls every live host (`GET /lip/native/sync`, every ~1.2 s while a native
   window is open, every ~3.6 s otherwise; the `tool.call` hook on the lets
   `open` tool makes a new pane appear at once);
2. opens one pane per window (`$.ui.open`, id `lets-w-<windowId>`, the
   unique's title and wanted width) and draws the tree with the surface's own
   elements (`$.ui.resolve`); an element the surface lacks (SVG on the
   terminal, inputs on mobile) draws as text;
3. posts the person's presses, Enters and picks back (`POST
   /lip/native/action`) and draws the tree the host answers, at once;
4. closes the pane when the host says the window closed (Send to Claude's
   farewell, Claude's `session.close`), and tells the host when the person
   closes the pane (`POST /lip/native/close`).

Nothing of a unique runs in this mod. The host token comes from
`~/.lets/run/host-*.json` on every use and is never kept in `$.state`.

Several Claude Code sessions each run a lets host; the mod learns which host is
this session's from the `open` results it sees, and until it has seen one it
shows every host's native windows.

## Install

```
/plugin install lets-native@lets
```

or `node install.mjs --native` from the engine checkout. Then restart Claude
Code and run `/lets graph native`.

## Develop

`claude --plugin-dir ./mods/lets-native` (or hot reload through the
plugin-authoring skill). Check it with a 2.1.287+ CLI:

```
claude plugin validate ./mods/lets-native
claude plugin test ./mods/lets-native
```

`tests/native.test.tsx` fakes a host (`http.fetch`, the run files) and mounts
the pane on the desktop and terminal surfaces. Older CLIs warn about the
`types` field and ignore `modules`.
