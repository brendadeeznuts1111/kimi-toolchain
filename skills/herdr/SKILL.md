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
metadata:
  upstream:
    repo: https://github.com/ogulcancelik/herdr
    commit: d998753efe506a04c80306795efc72bff60bb0ec
    skillUrl: https://github.com/ogulcancelik/herdr/blob/d998753efe506a04c80306795efc72bff60bb0ec/SKILL.md
  canonical: ~/.config/agents/skills/herdr/SKILL.md
  pinned: true
  companionSkill: orchestrator
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

## documentation layers

| Layer           | Source of truth                                  | Agent doc                                                                      |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| L1+L2           | `herdr` CLI, `herdr-pane`, socket API            | **this skill** — layout, pane I/O, waits                                       |
| L3              | `herdr-orchestrator`, finish-work, handoff rules | **orchestrator** skill                                                         |
| Troubleshooting | dx machine policy                                | [~/.config/dx/herdr.md](~/.config/dx/herdr.md) — sessions, remote, persistence |

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

**Close-loop coordination** (finish-work handoffs, reviewer escalation, reactive `watch-events`) is a separate skill: load **orchestrator** (`~/.config/agents/skills/orchestrator/SKILL.md` or `~/.grok/skills/orchestrator`). This skill covers layout and pane I/O only.

## session alignment

Herdr can run multiple named sessions. The CLI socket must match the server you intend:

- **Primary** (default): `herdr` with no `--session` → `~/.config/herdr/herdr.sock`
- **Named**: `herdr --session dev` → `~/.config/herdr/sessions/dev/herdr.sock`

Project `[herdr].session` in `dx.config.toml` must match every long-lived consumer (`herdr-orchestrator watch-events`, handoff rules, `herdr-project reconcile`). If `session = ""`, omit `--session` everywhere; if `session = "dev"`, pass `--session dev` on every command and daemon.

```bash
# verify you are on the intended socket
herdr status
herdr --session dev status   # when project uses named session
```

## environment variables

Official Herdr runtime vars ([integrations docs](https://herdr.dev/docs/preview/integrations/)):

| Variable              | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| `HERDR_CONFIG_PATH`   | Override config file path                             |
| `HERDR_SESSION`       | Named session label (see caveat below)                |
| `HERDR_SOCKET_PATH`   | Low-level socket path override (primary session only) |
| `HERDR_ENV`           | Set to `1` inside Herdr-managed pane processes        |
| `HERDR_PANE_ID`       | Public pane id for the running pane process           |
| `HERDR_TAB_ID`        | Public tab id for the running pane process            |
| `HERDR_WORKSPACE_ID`  | Public workspace id for the running pane process      |
| `HERDR_LOG`           | Log filter, e.g. `HERDR_LOG=herdr=debug`              |
| `HERDR_DISABLE_SOUND` | Disable sound even when notifications are enabled     |

**Session routing caveat (Herdr 0.7.0):** `HERDR_SESSION` env alone does **not** select the CLI socket. Automation must pass `herdr --session NAME` on the command line or set `HERDR_SOCKET_PATH` to the named session socket. kimi-toolchain implements this in `src/lib/herdr-project-cli.ts` (`herdrSessionArgs`, `herdrSessionEnv`).

**Inside a pane** (`HERDR_ENV=1`): use `HERDR_PANE_ID` for `herdr pane report-agent` / `report-metadata`. finish-work and reviewer escalation depend on these — see `docs/finish-work-close-loop.md`.

**Plugin invoke context** (Herdr injects on `herdr plugin action invoke`; not in the official table):

| Variable                    | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `HERDR_PLUGIN_CONTEXT_JSON` | Workspace cwd, pane ids, invocation source           |
| `HERDR_PLUGIN_EVENT_JSON`   | Event payload for hook-triggered actions             |
| `HERDR_PLUGIN_CLICKED_URL`  | URL for link-handler actions (PR/issue preview)      |
| `HERDR_PLUGIN_STATE_DIR`    | Plugin state dir (audit log, daemon pid)             |
| `HERDR_ORCHESTRATOR_DOMAIN` | Orchestrator domain for status/daemon plugin actions |

**Plugin action args:** current Herdr CLI does not forward `--` or trailing flags (`--json`, `--domain`) to action scripts. Prefer env vars above, run the action script directly for JSON, or read output from `herdr plugin log list --plugin herdr-orchestrator --limit 1` after invoke.

```bash
# named session + plugin action (orchestrator skill for status semantics)
herdr --session staging plugin action invoke herdr-orchestrator.status

# JSON + domain when CLI passthrough is unavailable
HERDR_PLUGIN_CONTEXT_JSON='{"workspace_cwd":"/path/to/project"}' \
HERDR_ORCHESTRATOR_DOMAIN=staging \
  /path/to/herdr-orchestrator/run.sh src/actions/status.ts --json --domain staging
```

## pane ids on this machine

Upstream examples use **compact session ids**: workspace `1`, tab `1:2`, pane `1-3`. Herdr **≥0.7** also exposes **stable handles**: workspace `wB`, tab `wB:t1`, pane `wB:p6G`.

On this Mac (dx-config + kimi-toolchain), prefer stable handles from live list commands — do not reuse ids from docs or old transcripts:

```bash
herdr pane list
herdr agent list
```

Ids **compact** when tabs/panes/workspaces close. Re-read after every split, close, or server restart. Handoff rules and orchestrator target panes by **agent name or label** (`herdr agent rename wB:p6G codex-primary`) — see `docs/handoff-rules.md` when pane cwd is the kimi-toolchain repo.

## key syntax

herdr uses a key-combo syntax: plain printable keys such as `a`, special keys such as `enter`, `tab`, `esc`, `backspace`, `left`, `right`, `up`, and `down`, modifier chords such as `ctrl+h`, `control+j`, `alt+x`, and `shift+tab`, function keys such as `f1`, and named punctuation such as `minus`, `plus`, and `backtick`. Legacy `C-c` and `c-c` are accepted as aliases for `ctrl+c`.

`pane run` submits text plus Enter atomically. Prefer it over `send-text` plus `send-keys Enter` for commands.

## agent commands (send, labels, explain)

Orchestrator handoffs and context-sync use **`herdr agent send`**, not `pane send-text`. Labels disambiguate multiple panes with the same agent name.

```bash
# list agents with pane ids, names, and rename labels
herdr agent list

# durable label for handoff rules (once per workspace)
herdr agent rename wB:p6G codex-primary

# deliver text to an agent pane (orchestrator handoff path)
herdr agent send wB:p6G "pick up from kimi — see finish-work brief"

# official spawn path (preferred over pane run for integrated agents)
herdr agent start codex --workspace wB --split right

# attach to one agent TUI from outside (streams; ctrl+b q detaches)
herdr agent attach wB:p6G
```

**Status authority** (why `wait agent-status` may disagree with what you see):

| Tier             | Agents                | State source                                                |
| ---------------- | --------------------- | ----------------------------------------------------------- |
| Lifecycle hooks  | kimi, hermes          | Integration reports `idle` / `working` / `blocked`          |
| Session + screen | codex, claude, cursor | Hooks restore session; **status from live screen snapshot** |
| Screen only      | grok                  | Manifest detection only                                     |

When handoff `pane.status` or `wait agent-status` looks wrong on codex/claude, debug with:

```bash
herdr agent explain wB:p6G --json
herdr agent read wB:p6G --source detection --format text
```

`blocked` means approval UI in the bottom buffer; otherwise screen-manifest agents often show `idle`. Wait for `done` when the agent finished but you have not focused that pane yet; wait for `idle` when you need the agent ready for new input.

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

list tabs in the current workspace (substitute live workspace id — prefer stable `wB` over compact `1`):

```bash
herdr tab list --workspace wB
```

create a new tab:

```bash
herdr tab create --workspace wB
```

without `--label`, the new tab keeps the default numbered tab name.

create and name it in one step:

```bash
herdr tab create --workspace wB --label "logs"
```

rename it:

```bash
herdr tab rename wB:t2 "logs"
```

focus it:

```bash
herdr tab focus wB:t2
```

close it:

```bash
herdr tab close wB:t2
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
# bun-native json parse (python3 also works)
NEW_PANE=$(herdr pane split 1-2 --direction right --no-focus | bun -e 'const j=JSON.parse(await Bun.stdin.text()); console.log(j.result.pane.pane_id)')
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
herdr wait agent-status wB:p6G --status idle --timeout 120000
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

For cross-agent task handoff in kimi-toolchain workspaces, prefer `herdr agent send <pane-id> "..."` (see [agent commands](#agent-commands-send-labels-explain)).

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

### watch another pane robustly

use this pattern when you need to coordinate with a sibling pane:

```bash
# inspect what is already there
herdr pane read 1-3 --source recent --lines 40

# wait only for the next output you expect
herdr wait output 1-3 --match "ready" --timeout 30000

# if you need to inspect the same transcript the waiter matched,
# read the unwrapped recent text directly
herdr pane read 1-3 --source recent-unwrapped --lines 40
```

### spawn a new agent and give it a task

prefer `herdr agent start` for integrated agents; `pane run` works for shells and quick experiments:

```bash
herdr agent start claude --workspace wB --split right --no-focus
# or legacy pane-run path:
herdr pane split 1-2 --direction right --no-focus
herdr pane run 1-3 "claude"
herdr wait output 1-3 --match ">" --timeout 15000
herdr pane run 1-3 "review the test coverage in src/api/"
```

### coordinate with another agent

```bash
herdr wait agent-status 1-1 --status done --timeout 120000
herdr pane read 1-1 --source recent --lines 100
```

### wait for blocked agent to become idle (handoff gate)

after resolving approval UI in the target pane:

```bash
herdr wait agent-status wB:p6G --status idle --timeout 120000
```

### debug wrong agent status (handoff / orchestrator)

when `herdr-orchestrator react` skips a rule because pane status mismatches:

```bash
herdr agent explain wB:p6F --json
herdr agent read wB:p6F --source detection --format text
herdr pane read wB:p6F --source recent-unwrapped --lines 30
```

if `blocked`, resolve approval in that pane; if codex shows `idle` but hooks say otherwise, trust `explain` over assumptions.

Re-read pane ids after every split/close — ids compact when panes are removed.

## notes

- `workspace list`, `workspace create`, `tab list`, `tab create`, `tab get`, `tab focus`, `tab rename`, `tab close`, `pane list`, `pane get`, `pane split`, `wait output`, and `wait agent-status` print json on success.
- `pane read` prints text, not json.
- `pane read --format ansi` or `pane read --ansi` returns a rendered ANSI snapshot for TUI feedback loops.
- `pane read --source recent-unwrapped` is useful when you want to inspect the same unwrapped transcript that `wait output --source recent` matches against.
- `pane send-text`, `pane send-keys`, and `pane run` print nothing on success.
- parse ids from `workspace create`, `tab create`, and `pane split` responses when you need new ids. `workspace create` returns `result.workspace`, `result.tab`, and `result.root_pane`. `tab create` returns `result.tab` and `result.root_pane`. for `pane split`, the new pane id is at `result.pane.pane_id`.
- use `pane read` for current output that already exists. use `wait output` for future output you expect next.
- `--no-focus` on split, tab create, and workspace create keeps your current terminal context focused.
- without `--label`, workspace create keeps cwd-based naming and tab create keeps numbered naming.
- `--label` on tab create and workspace create applies the custom name immediately.
- if you are running inside herdr, the `HERDR_ENV` environment variable is set to `1`.
- remote attach: `herdr --remote <ssh-host>` — see [how to work with Herdr](https://herdr.dev/docs/how-to-work/).
- debug against a dev server build: `env -u HERDR_SOCKET_PATH -u HERDR_CLIENT_SOCKET_PATH cargo run -- <command>` (contributor path; do not mix with production socket).
