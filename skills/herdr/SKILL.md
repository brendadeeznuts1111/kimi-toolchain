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
  For cross-pane handoffs, finish-work close-loop, or watch-events — load the
  orchestrator skill instead (layout control vs coordination).
layer: L1+L2
trigger:
  - HERDR_ENV=1 pane control
  - split pane or run command in sibling
  - wait for output or agent status
  - workspace or tab management
dependencies: []
loaded_by: HERDR_ENV gate
role: Herdr layout and pane I/O — socket CLI, waits, agent send
token_estimate: 1480
run_as: inline
metadata:
  upstream:
    repo: https://github.com/ogulcancelik/herdr
    commit: d998753efe506a04c80306795efc72bff60bb0ec
    skillUrl: https://github.com/ogulcancelik/herdr/blob/d998753efe506a04c80306795efc72bff60bb0ec/SKILL.md
  canonical: ~/.config/agents/skills/herdr/SKILL.md
  pinned: true
  companionSkills:
    - orchestrator
---

# Herdr (L1+L2)

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

## documentation layers

| Layer                      | Source of truth                                  | Agent doc                                                                                                               |
| -------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| L1+L2                      | `herdr` CLI, `herdr-pane`, socket API            | **this skill** — layout, pane I/O, waits                                                                                |
| L3                         | `herdr-orchestrator`, finish-work, handoff rules | **orchestrator** + **finish-work** skills                                                                               |
| Namespace / `@see` routing | Toolchain reference docs                         | [namespace.md](~/.kimi-code/docs/references/namespace.md#practical-see-ladder) — doctor trinity, finish-work vs plugins |
| Troubleshooting            | dx machine policy                                | [~/.config/dx/herdr.md](~/.config/dx/herdr.md) — sessions, remote, persistence                                          |

Do not duplicate L3 event tables or finish-work probe lists here.

## kimi-toolchain integration

When `kimi-toolchain` is installed, prefer these over raw `herdr` for programmatic use (`--json` on all):

| CLI                  | Use for                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `herdr-pane`         | Split/run/wait/read panes — typed Effect wrapper around socket API        |
| `herdr-latm`         | Pane capability mesh — `list`, `sync --project .`, `invoke --tool <name>` |
| `herdr-project`      | Apply/reconcile `[herdr]` layout from `dx.config.toml`                    |
| `herdr-orchestrator` | Cross-pane handoffs, `watch-events`, `context-sync`, `escalate`           |
| `herdr-doctor`       | Config symlinks, spawn wrappers, integration health                       |

Config/layout reference: [CODE_REFERENCES.md](~/.kimi-code/CODE_REFERENCES.md) § Herdr orchestration. In-pane recipes below use raw `herdr` — swap to `herdr-pane` when you need JSON or consistent exit codes.

L3 coordination: load **orchestrator** (`skills/orchestrator/SKILL.md`) and **finish-work** (`skills/finish-work/SKILL.md`).

## session alignment

Herdr can run multiple named sessions. The CLI socket must match the server you intend:

- **Primary** (default): `herdr` with no `--session` → `~/.config/herdr/herdr.sock`
- **Named**: `herdr --session dev` → `~/.config/herdr/sessions/dev/herdr.sock`

Project `[herdr].session` in `dx.config.toml` must match every long-lived consumer (`herdr-orchestrator watch-events`, handoff rules, `herdr-project reconcile`). If `session = ""`, omit `--session` everywhere; if `session = "dev"`, pass `--session dev` on every command and daemon.

```bash
herdr status
herdr --session dev status   # when project uses named session
```

## environment variables

Official Herdr runtime vars ([integrations docs](https://herdr.dev/docs/preview/integrations/)):

| Variable                 | Purpose                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `HERDR_CONFIG_PATH`      | Override config file path                                           |
| `HERDR_SESSION`          | Named session label (see caveat below)                              |
| `HERDR_SOCKET_PATH`      | Low-level socket path override (primary session only)               |
| `HERDR_SOCKET_TRANSPORT` | Orchestrator socket mode: `jsonl` (default), `websocket`, or `auto` |
| `HERDR_ENV`              | Set to `1` inside Herdr-managed pane processes                      |
| `HERDR_PANE_ID`          | Public pane id for the running pane process                         |
| `HERDR_TAB_ID`           | Public tab id for the running pane process                          |
| `HERDR_WORKSPACE_ID`     | Public workspace id for the running pane process                    |
| `HERDR_LOG`              | Log filter, e.g. `HERDR_LOG=herdr=debug`                            |
| `HERDR_DISABLE_SOUND`    | Disable sound even when notifications are enabled                   |

**Session routing caveat (Herdr 0.7.0):** `HERDR_SESSION` env alone does **not** select the CLI socket. Automation must pass `herdr --session NAME` on the command line or set `HERDR_SOCKET_PATH` to the named session socket. kimi-toolchain implements this in `src/lib/herdr-project-cli.ts` (`herdrSessionArgs`, `herdrSessionEnv`).

### unix socket lifecycle (Bun 1.4+)

Herdr listens on a filesystem unix socket (`herdr.sock`). Bun **1.4+** changed bind behavior:

| Phase           | Behavior                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Start**       | `Bun.listen({ unix: path })` creates `herdr.sock` and accepts connections                                                     |
| **Double bind** | Second bind on the same path throws **`EADDRINUSE`** (no silent socket replacement)                                           |
| **Stop**        | `server.stop()` closes the listener and **unlinks** the socket file                                                           |
| **Stale file**  | If `herdr.sock` exists but connect fails (`ECONNREFUSED`), the file is stale — remove it only after confirming no live server |

**Diagnostics:** `herdr-doctor` probes `socketFileExists` + `connectable` and emits structured hints for `ENOENT` (missing server), `EADDRINUSE` (path already bound), and `ECONNREFUSED` (stale or not ready). Taxonomy: `port_conflict` / `network_timeout` in `error-taxonomy.yml`.

```bash
herdr status
herdr-doctor                    # socket health + session alignment
rm -f ~/.config/herdr/herdr.sock && herdr server   # only when socket is stale
```

**Inside a pane** (`HERDR_ENV=1`): use `HERDR_PANE_ID` for `herdr pane report-agent` / `report-metadata`. finish-work and reviewer escalation depend on these — see `skills/finish-work/SKILL.md`.

Plugin invoke context vars (`HERDR_PLUGIN_CONTEXT_JSON`, `HERDR_ORCHESTRATOR_DOMAIN`, …): see `skills/orchestrator/SKILL.md`.

## pane ids on this machine

Upstream examples use **compact session ids**: workspace `1`, tab `1:2`, pane `1-3`. Herdr **≥0.7** also exposes **stable handles**: workspace `wB`, tab `wB:t1`, pane `wB:p6G`.

On this Mac (dx-config + kimi-toolchain), prefer stable handles from live list commands — do not reuse ids from docs or old transcripts:

```bash
herdr pane list
herdr agent list
```

Ids **compact** when tabs/panes/workspaces close. Re-read after every split, close, or server restart. Handoff rules target panes by **agent name or label** (`herdr agent rename wB:p6G codex-primary`) — see `docs/handoff-rules.md` when pane cwd is the kimi-toolchain repo.

## key syntax

herdr uses a key-combo syntax: plain printable keys such as `a`, special keys such as `enter`, `tab`, `esc`, `backspace`, `left`, `right`, `up`, and `down`, modifier chords such as `ctrl+h`, `control+j`, `alt+x`, and `shift+tab`, function keys such as `f1`, and named punctuation such as `minus`, `plus`, and `backtick`. Legacy `C-c` and `c-c` are accepted as aliases for `ctrl+c`.

`pane run` submits text plus Enter atomically. Prefer it over `send-text` plus `send-keys Enter` for commands.

## agent commands (send, labels, explain)

Orchestrator handoffs and context-sync use **`herdr agent send`**, not `pane send-text`. Labels disambiguate multiple panes with the same agent name.

```bash
herdr agent list
herdr agent rename wB:p6G codex-primary
herdr agent send wB:p6G "pick up from kimi — see finish-work brief"
herdr agent start codex --workspace wB --split right
herdr agent attach wB:p6G
```

**Status authority** (why `wait agent-status` may disagree with what you see):

| Tier             | Agents                | State source                                                |
| ---------------- | --------------------- | ----------------------------------------------------------- |
| Lifecycle hooks  | kimi, hermes          | Integration reports `idle` / `working` / `blocked`          |
| Session + screen | codex, claude, cursor | Hooks restore session; **status from live screen snapshot** |
| Screen only      | grok                  | Manifest detection only                                     |

When handoff `pane.status` or `wait agent-status` looks wrong on codex/claude:

```bash
herdr agent explain wB:p6G --json
herdr agent read wB:p6G --source detection --format text
```

`blocked` means approval UI in the bottom buffer. Wait for `done` when the agent finished but you have not focused that pane yet; wait for `idle` when you need the agent ready for new input.

## concepts

**workspaces** are project contexts. each workspace has one or more tabs. unless manually renamed, a workspace's label follows the first tab's root pane — usually the repo name, otherwise the root pane's current folder name.

**tabs** are subcontexts inside a workspace. each tab has one or more panes.

**panes** are terminal splits inside a tab. each pane runs its own process — a shell, an agent, a server, anything.

**agent status** is detected automatically by herdr. the api exposes one public field for it:

- `agent_status` — `idle`, `working`, `blocked`, `done`, `unknown`

`done` means the agent finished, but you have not looked at that finished pane yet.

plain shells still exist as panes, but herdr's sidebar agent section intentionally focuses on detected agents rather than listing every shell.

**ids** — see [pane ids on this machine](#pane-ids-on-this-machine) above. compact examples in recipes below (`1-1`) are illustrative; substitute live ids from `pane list` / `agent list`.

## discover yourself

```bash
herdr pane list
herdr workspace list
```

the focused pane is yours. other panes are your neighbors.

## tab management

```bash
herdr tab list --workspace wB
herdr tab create --workspace wB
herdr tab create --workspace wB --label "logs"
herdr tab rename wB:t2 "logs"
herdr tab focus wB:t2
herdr tab close wB:t2
```

## read another pane

```bash
herdr pane read 1-1 --source recent --lines 50
```

- `--source visible` = current viewport
- `--source recent` = recent scrollback as rendered in the pane
- `--source recent-unwrapped` = recent terminal text with soft wraps joined back together

## split a pane and run a command

```bash
herdr pane split 1-2 --direction right --no-focus
NEW_PANE=$(herdr pane split 1-2 --direction right --no-focus | bun -e 'const j=JSON.parse(await Bun.stdin.text()); console.log(j.result.pane.pane_id)')
herdr pane run "$NEW_PANE" "npm run dev"
herdr pane split 1-2 --direction down --no-focus
```

## wait for output

block until specific text appears in a pane. for `--source recent`, matching uses unwrapped recent terminal text.

```bash
herdr wait output 1-3 --match "ready on port 3000" --timeout 30000
herdr wait output 1-3 --match "server.*ready" --regex --timeout 30000
```

if it times out, exit code is `1`.

## wait for an agent status

```bash
herdr wait agent-status 1-1 --status done --timeout 60000
herdr wait agent-status wB:p6G --status idle --timeout 120000
```

## send text or keys to a pane

```bash
herdr pane send-text 1-1 "hello from claude"
herdr pane send-keys 1-1 Enter
herdr pane run 1-1 "echo hello"
```

For cross-agent task handoff in kimi-toolchain workspaces, prefer `herdr agent send <pane-id> "..."` (see [agent commands](#agent-commands-send-labels-explain)).

## workspace management

```bash
herdr workspace create --cwd /path/to/project
herdr workspace create --cwd /path/to/project --label "api server"
herdr workspace create --no-focus
herdr workspace focus 2
herdr workspace rename 1 "api server"
herdr workspace close 2
```

## close a pane

```bash
herdr pane close 1-3
```

## recipes

### run a server and wait until it is ready

```bash
NEW_PANE=$(herdr pane split 1-2 --direction right --no-focus | bun -e 'const j=JSON.parse(await Bun.stdin.text()); console.log(j.result.pane.pane_id)')
herdr pane run "$NEW_PANE" "npm run dev"
herdr wait output "$NEW_PANE" --match "ready" --timeout 30000
herdr pane read "$NEW_PANE" --source recent --lines 20
```

### run tests in a separate pane and inspect the result

```bash
herdr pane split 1-2 --direction down --no-focus
herdr pane run 1-3 "cargo test"
herdr wait output 1-3 --match "test result" --timeout 60000
herdr pane read 1-3 --source recent --lines 30
```

### check what another agent is working on

```bash
herdr pane list
herdr agent list
herdr pane read 1-1 --source recent --lines 80
```

### spawn a new agent and give it a task

```bash
herdr agent start claude --workspace wB --split right --no-focus
herdr pane split 1-2 --direction right --no-focus
herdr pane run 1-3 "claude"
herdr wait output 1-3 --match ">" --timeout 15000
herdr pane run 1-3 "review the test coverage in src/api/"
```

Re-read pane ids after every split/close — ids compact when panes are removed.

## notes

- `workspace list`, `workspace create`, `tab list`, `tab create`, `tab get`, `tab focus`, `tab rename`, `tab close`, `pane list`, `pane get`, `pane split`, `wait output`, and `wait agent-status` print json on success.
- `pane read` prints text, not json.
- `pane read --format ansi` or `pane read --ansi` returns a rendered ANSI snapshot for TUI feedback loops.
- `pane read --source recent-unwrapped` matches the transcript `wait output --source recent` uses.
- `pane send-text`, `pane send-keys`, and `pane run` print nothing on success.
- parse ids from `workspace create`, `tab create`, and `pane split` responses when you need new ids.
- use `pane read` for current output; use `wait output` for future output you expect next.
- `--no-focus` on split, tab create, and workspace create keeps your current terminal context focused.
- if you are running inside herdr, the `HERDR_ENV` environment variable is set to `1`.
- remote attach: `herdr --remote <ssh-host>` — see [how to work with Herdr](https://herdr.dev/docs/how-to-work/).
