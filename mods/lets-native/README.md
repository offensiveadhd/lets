# lets-native

An optional **mod** (Claude Code function-hooks plugin, 2.1.287+) that adds
native touches to `lets` inside the Claude Code terminal or desktop Code tab:

| Command | Does |
|---|---|
| `/lets <args>` | bare alias → runs the `lets:lets` skill with the same args (`/lets graph`) |
| `/lets-pane` | opens a live pane: running hosts, open windows, the companion's name + mood, and the latest window events |

It needs nothing from the engine beyond what the prompt hook already uses:
it reads `~/.lets/run/host-*.json` for port + token and polls
`GET /lip/drain?cursor=pane` every 5 s through the host's own fetch.

Install:

```
/plugin install lets-native@lets
```

Develop: `claude --plugin-dir ./mods/lets-native` (or hot reload via the
plugin-authoring skill). Validate with `claude plugin validate ./mods/lets-native`
on a 2.1.287+ CLI; older CLIs warn about the `types` field and ignore `modules`.
