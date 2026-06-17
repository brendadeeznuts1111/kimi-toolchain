---
name: orchestrator
description: |
  Coordinate work across Herdr panes in a project workspace. Use for handoffs between
  agents, reviewer escalation after finish-work, context sync when agent status changes,
  and reactive watch-events. Requires HERDR_ENV=1 and an enabled [herdr.orchestrator] profile.
whenToUse: |
  Lead agent in a Herdr project workspace closing the loop across panes — handoffs,
  context-sync after commits, watch-events, or reviewer escalation after finish-work.
  For layout and pane I/O only, load the herdr skill instead.
layer: L3
trigger:
  - handoff between Herdr panes
  - watch-events or context-sync
  - finish-work escalation follow-up
  - effect.gates.changed react
dependencies:
  - herdr
loaded_by: HERDR_ENV gate / On-demand
role: Multi-pane coordination — handoffs, reactive events, context delivery
token_estimate: 920
metadata:
  companionSkill: herdr
---

# Orchestrator (L3)

Use this skill when you are the **lead agent** in a Herdr project workspace and need to close the loop across panes — not just control layout (see the `herdr` skill for that).

## Preconditions

1. `HERDR_ENV=1` — you are inside a Herdr pane.
2. Project has `[herdr]` enabled in `dx.config.toml` or `.dx/herdr.toml`.
3. Optional `[herdr.orchestrator]` block configures handoff targets (defaults: primary → first secondary).
4. Optional `[herdr.orchestrator.events]` enables continuous reactive coordination.

If orchestrator is disabled or you are outside Herdr, stop and tell the user.

## Commands (PATH)

All commands take the project root (default: pane cwd). Use `--json` for machine-readable output.

```bash
herdr-orchestrator status .
herdr-orchestrator react .
herdr-orchestrator context-sync .
herdr-orchestrator escalate .
herdr-orchestrator watch-events .          # event-driven (preferred for long sessions)
herdr-orchestrator react . --watch         # poll every 15s (legacy fallback)
```

## When to run

| Trigger                                   | Command               | What happens                                                                                      |
| ----------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| After workspace rebuild / layout apply    | `context-sync`        | Runs each `[[herdr.agentsTab.panes]].context` command and `herdr agent send`s output to that pane |
| Primary agent finished a chunk of work    | `react`               | On **working → idle**, syncs context (if configured) and sends handoff summary to secondary       |
| `finish-work` pushed but tree still dirty | `escalate` or `react` | Opens reviewer tab and runs reviewer pane script                                                  |
| Long session — continuous awareness       | `watch-events`        | Subscribes to Herdr socket events + git HEAD; debounced context-sync and react                    |
| Manual refresh only                       | `context-sync`        | One-shot context delivery                                                                         |

## Reactive layer (`watch-events`)

Bootstrap starts `watch-events` in the shell pane after agents are up. You normally do **not** need to start it manually.

### Event → action map

| Event                         | Action         | Source                                                   |
| ----------------------------- | -------------- | -------------------------------------------------------- |
| `workspace.updated`           | `context-sync` | Herdr socket or `finish-work` metadata after commit/push |
| `reviewer.feedback.processed` | `context-sync` | Post-review metadata from `finish-work` / reviewer pane  |
| `git.ref.changed`             | `context-sync` | `.git/HEAD` watch (commits while agents run)             |
| `pane.agent_status_changed`   | `react`        | Agent idle/done transitions → handoff                    |
| `effect.gates.changed`        | `react`        | `kimi-doctor --watch` via `pane report-metadata`         |

Debounce coalesces bursts (default 2s; config `debounce_ms`). Scope is workspace-scoped — never bare agent names when multiple workspaces are open.

### Auto-delivered context vs manual refresh

- **Auto:** `watch-events` and reconcile/bootstrap run `context-sync` — agents receive briefs without `@refresh`.
- **Manual:** `herdr-orchestrator context-sync .` when you suspect drift or after editing `dx.config.toml`.
- **Fallback files:** `/tmp/workspace-context.md` and `/tmp/workspace-context.json` (override with `HERDR_CONTEXT_FILE` / `HERDR_CONTEXT_JSON_FILE`).

Agents should treat auto-delivered context as authoritative after commits; use manual `context-sync` only when events are disabled or debugging.

## Coordination contract

### Pane roles (from `[herdr.agentsTab]`)

| Role             | Owner                                       | Delivers                                                    |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------- |
| **primary**      | Lead implementer (kimi / grok)              | Code changes, plans, commits via `finish-work`              |
| **secondary**    | Reviewer / alternate model (codex / claude) | Picks up handoff brief, challenges assumptions              |
| **shell**        | Human + gates                               | `bootstrap` commands, `watch-events` background, git status |
| **doctor tab**   | Health                                      | `kimi-doctor --watch` (emits `effect.gates.changed`)        |
| **reviewer tab** | Post-push cleanup                           | `reviewer-pane.ts` when finish-work escalates               |

### Handoff format

`react` captures recent output from the primary pane and sends:

```
[orchestrator handoff from kimi]
<last lines of primary scrollback>

Pick up from here or ask the primary for clarification.
```

Target is `handoffTo` (pane id scoped to this workspace).

Post-review handoff rules use probe `finish-work:handoff-ready` with `when = { finishWorkReport.review.resolved = true, pane.status = "idle" }` on the source pane.

### Context sync

Pane `context` commands (e.g. `kimi-doctor --workspace-context --brief --write-context-files`) run in the **project root**. Output is injected via `herdr agent send`; JSON sidecar written for programmatic agents.

### Pane `requires`

Declare tools each agent pane needs before startup:

```toml
[[herdr.agentsTab.panes]]
role = "primary"
agent = "kimi"
requires = ["git", "kimi-doctor"]
```

Resolution: `which` → `bun x` fallback → bootstrap blocks agent start with a warning if missing.

## Config reference

```toml
[herdr.orchestrator]
enabled = true
contextOnIdle = true
handoffFrom = "kimi"
handoffTo = "codex"
reviewerTab = "reviewer"

[herdr.orchestrator.events]
enabled = true
debounce_ms = 2000
allowlist = ["workspace.updated", "reviewer.feedback.processed", "pane.agent_status_changed", "effect.gates.changed", "git.ref.changed"]
watchGit = true
```

## Plugin actions (`herdr-orchestrator`)

The linked plugin at `dev/herdr-plugins/herdr-orchestrator` exposes actions via Herdr's plugin CLI. After adding actions to `herdr-plugin.toml`, refresh the manifest:

```bash
herdr plugin unlink herdr-orchestrator
herdr plugin link /path/to/herdr-orchestrator
```

| Action id                                         | Purpose                                         |
| ------------------------------------------------- | ----------------------------------------------- |
| `herdr-orchestrator.status`                       | Fleet health, agents, handoff rules, daemon pid |
| `herdr-orchestrator.daemon-start` / `daemon-stop` | Domain health daemon                            |
| `herdr-orchestrator.agent-list`                   | Remote fleet snapshot                           |
| `herdr-orchestrator.bootstrap`                    | Remote host plugin install + daemon             |

```bash
herdr plugin action invoke herdr-orchestrator.status
herdr plugin log list --plugin herdr-orchestrator --limit 1
```

**Env vars for plugin actions:**

| Variable                    | Purpose                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `HERDR_ORCHESTRATOR_DOMAIN` | Domain name (e.g. `staging`) when CLI flags are not forwarded  |
| `HERDR_PLUGIN_CONTEXT_JSON` | Set `workspace_cwd` when running action scripts outside invoke |
| `HERDR_PLUGIN_STATE_DIR`    | Audit log and daemon pid files                                 |

**CLI limits:** `herdr plugin action invoke … -- --json --domain staging` fails on current Herdr (`unknown option: --`). Use `HERDR_ORCHESTRATOR_DOMAIN`, direct `run.sh` invocation, or `herdr-orchestrator status . --json` for the kimi-toolchain orchestrator view (different schema).

**Session:** use `herdr --session NAME plugin action invoke …` — not `HERDR_SESSION=NAME` alone on Herdr 0.7.0. See `skills/herdr/SKILL.md` § environment variables.

## Related skills

- **herdr** — pane/tab/workspace control (`herdr pane list`, `agent send`, `wait`)
- **finish-work** — gates, commit/push, dirty-tree escalation
- **kimi-toolchain** — `kimi-doctor`, gates, sync

Code: `src/lib/herdr-orchestrator.ts`, `src/lib/herdr-orchestrator-events.ts`. Exemplars: [~/.kimi-code/CODE_REFERENCES.md](~/.kimi-code/CODE_REFERENCES.md) § Herdr orchestration.

## Do not

- Run orchestrator from outside Herdr expecting pane side effects — `escalate`, `agent send`, and `watch-events` need a live server.
- Use bare agent names when multiple workspaces run the same agent label — prefer pane ids from `herdr agent list`.
- Replace `finish-work` gates — orchestrator reacts to outcomes; it does not commit or push.
- Poll with `react --watch` when `watch-events` is already running — duplicate work.
