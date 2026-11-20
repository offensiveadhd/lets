# promo

How the animations in the lets READMEs are made: every GIF and video is a recording of the real window,
served by the real host, cut by a script. Nothing is drawn by hand as if it were the product.

```
lib/cdp.mjs          a zero-dependency headless-browser driver over CDP (Edge or any Chromium)
lib/rig.mjs          the stage: a host on a throwaway LETS_HOME, a browser on one window, a pointer the
                     camera can see, Claude's side, and the screencast recorder
lib/host-child.mjs   the engine as a child process; the recorder calls its tools over IPC
scenes/<name>.mjs    one script per clip: what the hand does, what Claude answers, the marks
cuts/<name>.json     the cuts of that clip: which seconds become which GIF or MP4 in which repo
cuts/tour.json       the family tour: a few seconds of each clip, each under a caption
record.mjs           runs the scenes, one after another      -> footage/<name>.mp4 + <name>.json
gifs.mjs             cuts the footage                         -> <repo>/assets/*.gif, *.mp4
tour.mjs             joins parts of several clips             -> assets/tour.gif, tour.mp4
footage/  out/       left behind by the recorder; not committed
```

It needs Node 22 or later, `ffmpeg` on PATH, and Edge or Chrome (`PROMO_BROWSER` names another Chromium).
Nothing is installed: no `npm install`, no Playwright. The uniques are taken from the checkouts beside
this one (`../lets-unique-*`) and the website from `../lets-site`, so clone the repos side by side.

```bash
node promo/record.mjs            # every scene, the takes that count: 1920x1080
node promo/record.mjs graph      # one
node promo/gifs.mjs              # every cut
node promo/tour.mjs              # the tour in the engine's README
node promo/scenes/graph.mjs      # a scene by itself records a draft: 1280x720, lighter frames
node promo/scenes/_probe.mjs den # a look at a window before writing its scene: a PNG and the list of controls
```

A take through `record.mjs` is final (`PROMO_FINAL=1`): the page is rendered at 1.5x, so the footage is
1920x1080, and the frames are kept near-lossless until they are encoded. A scene run by itself is a draft at
1x, which is what you want while writing one: it needs about a fifth of the temp space. The cuts name marks
and CSS pixels, so the same cuts file fits both.

## What is real and what is scripted

The window is the unique's own page on a real lets host, started on a throwaway `LETS_HOME` so the
recording never touches `~/.lets`. The hand is a headless browser driven through CDP's Input domain: the
page gets trusted pointer and key events. A screencast holds no OS cursor, so the rig adds an arrow that
follows those events and a ring on every press; that arrow is the only thing in the frame the product did
not draw.

Claude's side is scripted. The recorder reaches the engine's own tool handlers, the ones the MCP server
gives Claude (`open`, `listen`, `send`, `say`, `query`, `entity`, `sessions`, `run`), and sends what Claude
would send, written ahead, because a recording cannot wait on a live model. The loop that keeps the window
on "listening" is the real `listen` long-poll. So every command in the footage is one Claude can send, and
every reaction of the window is the window's.

The tour adds one more thing: a caption under each part. It is drawn by the same headless browser as a
transparent picture and laid over the footage; the footage under it is untouched.

## Writing a scene

```js
import { stage, sleep } from '../lib/rig.mjs';

const s = await stage({ unique: 'graph', name: 'graph', debugPort: 9351 });
const { b, claude, rec } = s;

await rec.start();
rec.mark('open');
await s.clickOn('#btn-send');                                   // glide, a beat, click
await b.type('Auth service', { cps: 14 });                      // keys, a character at a time
await claude.send('graph.node.add', { label: 'Cache', kind: 'data' });
const ev = await claude.next('graph.ask', { timeout: 8000 });   // what the window sent up
await claude.stream('Two things are missing.', { mood: 'curious' });
rec.mark('answered');
await sleep(1500);
await s.end();                                                  // footage/graph.mp4 + graph.json
process.exit(0);
```

| | |
|---|---|
| `stage({ unique, name, debugPort, w, h, scale, args, resume, hostOptions })` | host + browser + window + pointer + Claude's loop + recorder. 1280x720 CSS pixels; 1.5x in a final take, 1x in a draft. `{ url, host: false }` records a plain page with no engine. `hostOptions.engine` runs another checkout's `engine/`. |
| `s.b` | the driver: `glide(x, y, ms)`, `click()`, `dblclick()`, `rightclick()`, `dragTo(x, y, ms)`, `wheel(dy)`, `key('Enter', { ctrl, shift, alt })`, `type(text, { cps })`, `insert(text)`, `eval(js)`, `shot(file)` |
| `s.rect(t)`, `s.glideTo(t)`, `s.clickOn(t)` | `t` is a selector, `{ text: 'Send' }` for the visible control with that text, or `{ js: '…' }` for an expression that returns an element or a box |
| `s.waitFor(js, { timeout })` | polls a page expression until it is truthy |
| `s.claude` | `send(type, data)` or `send([{ type, data }, …])`, `say(text, { via, mood })`, `stream(text, { mood })`, `query(type, data)`, `next(type, { timeout })`, `on(type, fn)`, `tool(name, args)`, and `seen`, every event so far |
| `s.rec` | `start()`, `mark(what, extra)`, `stop()`; `s.end()` stops everything |
| `s.host` | `tool(name, args)`, `file(...path)` under the throwaway home, `origin`, `token` |
| `s.shot('name.png')` | a PNG into `out/shots/`, to look at while writing |

## What goes wrong

- **Selectors, not coordinates.** Layouts move. Ask the page for the box (`s.rect`) and aim at it.
- **Wait for the page, not the clock.** After a command, `s.waitFor` what it changes; then hold a beat with
  `sleep` so a viewer can read it. A scene that only sleeps passes on this machine and fails on the next.
- **Marks carry the cuts.** `rec.mark('ghost.shown')` at every moment a cut may start or end; `cuts/*.json`
  names marks with offsets (`"ghost.shown-0.4"`), so a new take needs no new numbers.
- **One browser at a time for the take that counts.** Two screencasts on one machine halve each other's
  frame rate, and several headless browsers at once cost real memory. `record.mjs` runs scenes in sequence;
  a scene picks its own `debugPort` so a look at one window while another records still works.
- **Close the browser, not the process you started.** On Windows the Edge you spawn is a launcher: it exits
  at once and the real browser lives on, holding its profile folder. `b.close()` asks the browser to close
  on its own DevTools endpoint and removes the folder when the port is silent. A scene that exits without
  `s.end()` or `b.close()` leaves a browser running.
- **The disk.** A final take keeps its frames in the temp folder until they are encoded, about 150 MB for
  45 seconds. The recorder will not start with less than 800 MB free (450 MB for a draft) and stops a take
  that would run the drive under 250 MB, so a recording is never what fills a disk.
- **A hash-only navigation loads nothing.** `b.goto` waits for a load event; the same page with another
  `#hash` fires none. Open a new window instead.
- **Timing input belongs in the page.** A CDP round trip is 5 to 20 ms and now and then 200. For input that
  must keep time (Morse), schedule it inside the page with `b.eval` and `setTimeout`.
- **A handoff closes the window.** After *Send to Claude* the page runs `window.close()`. Take the mark and
  the last second before it, or record the farewell and end the scene.
- **`backdrop-filter`** costs the software rasteriser frames. The shell and the toolbars use it; at 1280x720
  the screencast still holds about 27 fps at 1.5x here. If a scene drops under 15, look for a blur first.
- **The pointer wakes Doto.** He follows the cursor, so park the pointer where he will not cover what the
  cut is about, and keep it moving the way a hand does: glide, rest, act.

## GIFs

`gifs.mjs` writes GIFs with a palette built from the cut itself. Installing a unique is a clone of its
repository, so every megabyte here is a megabyte on someone's disk: keep a README's main GIF at 720 pixels
wide and under 1.8 MB, a detail GIF (a `crop` of the window: the editor, a card) under 900 KB, the full take
as an MP4 under 1.2 MB (`"to": ["<repo>/assets/demo.mp4"]`), and the sum for one repository under 4.5 MB.
Set `maxKb` on a cut and `gifs.mjs` says when it is over. To come back under: shorten the cut, crop it,
drop to 10 frames a second, or lower `colors`.
