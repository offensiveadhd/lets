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
