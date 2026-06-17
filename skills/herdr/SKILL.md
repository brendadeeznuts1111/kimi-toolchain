---
name: herdr
description: |
  Control herdr from inside it. Manage workspaces and tabs, split panes,
  spawn agents, read output, and wait for state changes — all via CLI
  commands that talk to the running herdr instance over a local unix socket.
  Use when running inside herdr (HERDR_ENV=1).
whenToUse: |
  Agent is running inside herdr and needs to discover panes, split terminals,
  run commands in sibling panes, wait for server output, coordinate with
  other agents, or manage workspaces/tabs programmatically.
  Also use when the user asks to "split this", "run that in another pane",
  "start a server over there", or "check what the other agent is doing".
---

# herdr — agent skill

before using this skill, check that `HERDR_ENV=1`. if it is not set to `1`, say you are not running inside a herdr-managed pane and stop. do not inspect or control the focused herdr pane from outside herdr.

you are running inside herdr, a terminal-native agent multiplexer. herdr gives you workspaces, tabs, and panes — each pane is a real terminal with its own shell, agent, server, or log stream — and you can control all of it from the cli.

this means you can:

- see what other panes and agents are doing
- create tabs for separate subcontexts inside one workspace
- split panes and run commands in them
- start servers, watch logs, and run tests in sibling panes
- wait for specific output before continuing
- wait for another agent to finish
- spawn more agent instances

the `herdr` binary is available in your PATH. its workspace, tab, pane, and wait commands talk to the running herdr instance over a local unix socket.

if you need the raw protocol or full api reference, read the [socket api docs](https://herdr.dev/docs/socket-api/).

## kimi-toolchain integration

When `kimi-toolchain` is installed, prefer these over raw `herdr` for programmatic use (`--json` on all):

| CLI                  | Use for                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `herdr-pane`         | Split/run/wait/read panes — typed Effect wrapper around socket API        |
| `herdr-latm`         | Pane capability mesh — `list`, `sync --project .`, `invoke --tool <name>` |
| `herdr-project`      | Apply/reconcile `[herdr]` layout from `dx.config.toml`                    |
| `herdr-orchestrator` | Cross-pane handoffs, `watch-events`, `context-sync`, `escalate`           |
| `herdr-doctor`       | Config symlinks, spawn wrappers, integration health                       |

Config/layout reference: [CODE_REFERENCES.md](../../CODE_REFERENCES.md) § Herdr orchestration. In-pane recipes below use raw `herdr` — swap to `herdr-pane` when you need JSON or consistent exit codes.

## key syntax

herdr uses a key-combo syntax: plain printable keys such as `a`, special keys such as `enter`, `tab`, `esc`, `backspace`, `left`, `right`, `up`, and `down`, modifier chords such as `ctrl+h`, `control+j`, `alt+x`, and `shift+tab`, function keys such as `f1`, and named punctuation such as `minus`, `plus`, and `backtick`. Legacy `C-c` and `c-c` are accepted as aliases for `ctrl+c`.

`pane run` submits text plus Enter atomically. Prefer it over `send-text` plus `send-keys Enter` for commands.

## concepts

**workspaces** are project contexts. each workspace has one or more tabs. unless manually renamed, a workspace's label follows the first tab's root pane — usually the repo name, otherwise the root pane's current folder name.

**tabs** are subcontexts inside a workspace. each tab has one or more panes.

**panes** are terminal splits inside a tab. each pane runs its own process — a shell, an agent, a server, anything.

**agent status** is detected automatically by herdr. the api exposes one public field for it:

- `agent_status` — `idle`, `working`, `blocked`, `done`, `unknown`

`done` means the agent finished, but you have not looked at that finished pane yet.

plain shells still exist as panes, but herdr's sidebar agent section intentionally focuses on detected agents rather than listing every shell.

**ids** — workspace ids look like `1`, `2`. tab ids look like `1:1`, `1:2`, `2:1`. pane ids look like `1-1`, `1-2`, `2-1`. these are compact public ids for the current live session.

important: ids can compact when tabs, panes, or workspaces are closed. do not treat them as durable ids. re-read ids from `workspace list`, `tab list`, `pane list`, or create/split responses when you need a current id. do not guess that an older `1-3` is still the same pane later.

## discover yourself

see what panes exist and which one is focused:

```bash
herdr pane list
```

the focused pane is yours. other panes are your neighbors.

list workspaces:

```bash
herdr workspace list
```

## tab management

list tabs in the current workspace:

```bash
herdr tab list --workspace 1
```

create a new tab:

```bash
herdr tab create --workspace 1
```

without `--label`, the new tab keeps the default numbered tab name.

create and name it in one step:

```bash
herdr tab create --workspace 1 --label "logs"
```

rename it:

```bash
herdr tab rename 1:2 "logs"
```

focus it:

```bash
herdr tab focus 1:2
```

close it:

```bash
herdr tab close 1:2
```

## read another pane

see what is on another pane's screen:

```bash
herdr pane read 1-1 --source recent --lines 50
```

- `--source visible` = current viewport
- `--source recent` = recent scrollback as rendered in the pane
- `--source recent-unwrapped` = recent terminal text with soft wraps joined back together

## split a pane and run a command

split your pane to the right and keep focus on your current pane:

```bash
herdr pane split 1-2 --direction right --no-focus
```

that prints json with the new pane nested at `result.pane.pane_id`. parse that value, then run a command in that pane:

```bash
NEW_PANE=$(herdr pane split 1-2 --direction right --no-focus | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
herdr pane run "$NEW_PANE" "npm run dev"
```

split downward instead:

```bash
herdr pane split 1-2 --direction down --no-focus
```

## wait for output

block until specific text appears in a pane. useful for waiting on servers, builds, and tests.

for `--source recent`, matching uses unwrapped recent terminal text, so pane width and soft wrapping do not break matches. `pane read --source recent` still shows the pane as rendered. if you want to inspect the same transcript that the waiter matches, use `pane read --source recent-unwrapped`.

```bash
herdr wait output 1-3 --match "ready on port 3000" --timeout 30000
```

with regex:

```bash
herdr wait output 1-3 --match "server.*ready" --regex --timeout 30000
```

if it times out, exit code is `1`.

## wait for an agent status

block until another agent reaches a specific status:

```bash
herdr wait agent-status 1-1 --status done --timeout 60000
```

use this when you want the same `done` / `idle` distinction the UI shows.

## send text or keys to a pane

send text without pressing Enter:

```bash
herdr pane send-text 1-1 "hello from claude"
```

press Enter or other keys:

```bash
herdr pane send-keys 1-1 Enter
```

`pane run` sends the text and then a real `Enter` key in one request:

```bash
herdr pane run 1-1 "echo hello"
```

## workspace management

create a new workspace:

```bash
herdr workspace create --cwd /path/to/project
```

without `--label`, the new workspace keeps the default cwd-based name.

create and name one in one step:

```bash
herdr workspace create --cwd /path/to/project --label "api server"
```

create one without focusing it:

```bash
herdr workspace create --no-focus
```

focus a workspace:

```bash
herdr workspace focus 2
```

rename:

```bash
herdr workspace rename 1 "api server"
```

close:

```bash
herdr workspace close 2
```

## close a pane

```bash
herdr pane close 1-3
```

## recipes

### split, run, wait (server, tests, or long command)

```bash
herdr pane split 1-2 --direction right --no-focus   # note new pane id from JSON
herdr pane run 1-3 "npm run dev"
herdr wait output 1-3 --match "ready" --timeout 30000
herdr pane read 1-3 --source recent --lines 30
```

Re-read pane ids after every split/close — ids compact when panes are removed.

### inspect or coordinate with another pane/agent

```bash
herdr pane list
herdr pane read 1-1 --source recent --lines 80          # current output
herdr wait output 1-3 --match "ready" --timeout 30000   # future output
herdr pane read 1-3 --source recent-unwrapped --lines 40
herdr wait agent-status 1-1 --status done --timeout 120000
```

## notes

- JSON on success: `workspace *`, `tab *`, `pane list|get|split`, `wait *`. Text only: `pane read` (use `--source recent-unwrapped` to match `wait output`).
- `pane run` submits text + Enter atomically; prefer it over `send-text` + `send-keys enter`.
- Parse new ids from create/split JSON (`result.pane.pane_id`, `result.workspace`, etc.). Do not reuse stale ids.
- `--no-focus` keeps your pane focused when splitting or creating tabs/workspaces.
- `HERDR_ENV=1` when running inside herdr.
