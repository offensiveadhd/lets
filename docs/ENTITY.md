# The companion entity

The entity is Claude's presence inside a window: a small, bright, eager orb
that follows the cursor, suggests, listens, and remembers.

## Persona

`~/.lets/entity/persona.json`

| Field | Meaning |
|---|---|
| `name` | default **Pip**; the human can rename it (`/lets entity rename …`) |
| `traits.speed` | how quickly it follows (0 calm … 1 snappy) |
| `traits.distance` | preferred offset from the cursor |
| `traits.chatty` | how much it says unprompted |
| `traits.playful` | squash, bob, blink intensity |
| `traits.formality` | tone of its lines |
| `traits.curiosity` | how often it asks instead of assumes |
| `likes` / `dislikes` | learned preferences ("short labels", "being interrupted") |
| `nicknames` | what the human calls things |
| `mood` | last mood |

The shell receives `entity.persona` on connect and tunes its spring, bubble
frequency and animations from it.

## Learning

Three honest channels, all on disk:

1. **Profile** — the shell measures aggregates (pace, click rate, dwell, favourite
   screen regions, idle time, summons/picks/dismisses) and emits
   `entity.profile` at most once a minute. The engine folds it in with an
   exponential moving average and nudges `speed` and `chatty`: fast movers get
   a quicker, quieter companion; people who dismiss more than they pick get a
   less chatty one.
2. **Memory** — `entity learn {text, likes, dislikes, traits, nicknames}`:
   Claude writes down what it noticed. The last few lines are in every brief.
3. **Special skills** — `entity teach {name, triggers, body}`: a markdown
   playbook in `~/.lets/entity/skills/<slug>.md` with frontmatter
   (`triggers`, `confidence`, `uses`, `unique`). The index is in every brief;
   bodies are read on demand when triggers match. `reinforce` nudges
   confidence up or down after use; `forget` removes.

Nothing is inferred silently. If the companion "knows" something, there is a
line in `memory.jsonl`, a field in `profile.json` or a skill file that says so.

## Voice

In the window the companion speaks as itself (short, warm, specific). In the
transcript Claude keeps its normal voice. Rules of thumb the skill enforces:

- one line to greet, never a paragraph;
- `thinking` mood while working, `proud` when done, `curious` when asking;
- suggest, point (`graph.highlight`), never nag;
- when `chatty` is low, speak only when spoken to or when something changed.

## Movement

Critically damped spring toward an offset beside the cursor, 24 px dead-zone,
side flip near edges, idle bob after 2.5 s, blink every few seconds,
`prefers-reduced-motion` honoured. All client-side: the companion costs zero
tokens until the human clicks it.

## Expressions & secret moves

Besides its moods, the companion has short reactions: a second or two of a
different face, a little motion, sometimes a prop (a heart, a sweat drop,
music notes). Most it plays by itself from how the human moves, all of them
can be played with `entity.react {name}`, and none of them costs a token or
blocks a click. Each has a cooldown so it never nags; with
`prefers-reduced-motion` only the face and glow change, nothing spins or jumps.

| name | looks like | when |
|---|---|---|
| `dizzy` | spiral eyes, then x_x, wobble, stars | very fast pointer travel for ~1.5 s, a mouse shake, or circling it twice in 3 s |
| `whoa` | big eyes, leans back, aura pulse | a fast wheel or zoom burst |
| `startled` | wide eyes, little jump, sweat drop | a click storm (6 clicks in 1.5 s) |
| `gasp` | "o" mouth, hands to cheeks | Delete / Backspace outside a text field |
| `oops` | `> <` squint, head tilt | Ctrl+Z |
| `wink` | one eye closes, a twinkle | Claude or the unique (graph: an edge connected) |
| `cheer` | arms up, two hops, confetti | Claude or the unique (graph: Send pressed) |
| `blush` | glowing cheeks, looks away | the pointer rests on it for 1.5 s |
| `boop` | squish, a heart | a quick click on it |
| `yawn` | eyes shut, wide "o", stretch | idle 25–40 s, just before it dozes |
| `peek` | eyes dart, leans toward the pointer | the pointer comes back after 10 s away |
| `nod` / `shake-no` | up-down / left-right | Claude or the unique |
| `wave` | a raised hand, sway | the pointer leaves the window; the farewell when a window closes |
| `spin` | a full roll | double-click it |
| `dance` | a groove, music notes | type `pip` (or its name) outside a text field |
| `disco` | the dance with party lights | the Konami code ↑↑↓↓←→←→BA |
| `sparkle` | a star burst | Claude's "proud", or a burst of connections |
| `nightcap` | a night cap while it sleeps | sleepy between midnight and 5 am |
| `wheee` | squint, bright trail | the human drags it across the screen |

Seven of these are secrets: `spin`, `dance`, `disco`, `dizzy` by circling,
`nightcap`, a streak of five boops, and `wheee`. The first time the human
finds one in a window, the shell emits `entity.secret {name}` once, counts it
in the profile (`secrets`), and the companion says so in one line. Claude may
mention a find, rarely; the engine notes it in `memory.jsonl`.
