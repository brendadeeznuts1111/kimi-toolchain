# Herdr Orchestrator — Handoff Rules

Cross-workspace, cross-session agent handoff for the kimi-toolchain orchestrator.

## Rule format

```toml
[[herdr.orchestrator.handoff_rules]]
from_session = "dev"          # optional — defaults to current session
from_workspace = "w1"
from_agent = "test-agent"     # agent name or label (herdr agent rename)
condition = "done"             # "done" | "blocked > 5m" | "idle > 10m" | "probe:…"
to_session = "default"         # optional — defaults to from_session
to_workspace = "w0"
to_agent = "codex"             # agent name or label
target_strategy = "least_busy" # optional — "fixed" (default) | "least_busy"
```

Report-native rules omit `condition` and use `when` instead:

```toml
[[herdr.orchestrator.handoff_rules]]
from_workspace = "wB"
from_agent = "kimi"
to_workspace = "wB"
to_agent = "codex-primary"
when = { finishWorkReport.outcome = "clean", finishWorkReport.handoffCandidate.shouldHandoff = true }
```

## Spawn gates

Global probe IDs evaluated before **any** orchestrated agent spawn (`spawn_if_missing` or `spawn_fallback`). Use this to block agent creation until workspace-wide health checks pass.

```toml
[herdr.orchestrator]
spawn_gates = ["probe:canonical-references:runtime-aligned"]
```

With this configured, the orchestrator runs `auditCanonicalReferencesHealth` before spawning a target agent. If the runtime cache at `~/.kimi-code/canonical-references.json` is missing or drifted, the spawn is blocked and the handoff rule reports the fix command (`bun run sync`).

## Condition syntax

| Syntax                                       | Meaning                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `done`                                       | Agent is in "done" state                                                                |
| `blocked > Nm`                               | Agent has been blocked for N+ minutes                                                   |
| `idle > Nm`                                  | Agent has been idle for N+ minutes                                                      |
| `probe:canonical-references:runtime-aligned` | `~/.kimi-code/canonical-references.json` matches repo (fix: `bun run sync`)             |
| `probe:canonical-references:repo-fresh`      | Repo manifest matches `canonical-references.toml` (fix: `bun run references:generate`)  |
| `probe:canonical-references:runtime-cache`   | Runtime cache file exists at `~/.kimi-code/`                                            |
| `probe:bun-install:runtime-api-docs`         | `runtimeApiDocs` URLs point at `bun.com/docs/runtime/*` (SSOT: `bun-install-config.ts`) |
| `probe:bun-install:capabilities`             | Inventory capabilities present in `buildRuntimeCapabilities()`                          |
| `probe:bun-install:bun-image`                | `Bun.Image` supported, metadata probe passes, docs URL aligned (`src/lib/bun-image.ts`) |
| `probe:artifact-graph:context`               | Artifact context graph + gate execution DAG build (`GET /api/artifact-graph`)           |

**Convergence layer** (`GET /api/artifact-graph` → `convergence`): compares ecosystem manifest (`canonical-references.toml`), runtime inventory (`bun-install-config.ts` / `bunImage`), and artifact surfaces (`context.artifactStore`, `context.dag`) in one response. Gate orchestrator rules on `convergence.aligned` or per-pillar drift. SSOT: `src/lib/artifact-graph-convergence.ts`.

| `probe:finish-work:ok` / `finish-work:ok` | Report exists with `outcome: ok` and current `gitHead` |
| `finish-work:clean` | Gates passed, `outcome: ok`, clean tree (no push required) |
| `finish-work:pushed` / `probe:finish-work:pushed` | `ok` + `git.pushed` + clean tree |
| `finish-work:committed` | `git.committed` after successful gates |
| `finish-work:dirty` | Escalated or dirty post-push tree — reviewer handoff path |

### Report `when` clauses (v1.1)

AND all clauses against `.kimi/finish-work-report.json`. Paths must start with `finishWorkReport.`

| Example path                                      | Meaning                                      |
| ------------------------------------------------- | -------------------------------------------- |
| `finishWorkReport.outcome`                        | `"clean"` \| `"dirty"` \| `"escalated"` \| … |
| `finishWorkReport.handoffCandidate.shouldHandoff` | `true` when orchestrator should hand off     |
| `finishWorkReport.review.resolved`                | Reviewer feedback loop closed                |
| `finishWorkReport.git.hash`                       | Pin handoff to a specific close commit       |

Status conditions use orchestrator state timestamps (`.kimi/herdr-orchestrator-state.json`).
Canonical-ref probes call `auditCanonicalReferencesHealth`. Finish-work probes read the persisted report from `bun run finish-work` — agent status is not required.

Use **agent labels** (via `herdr agent rename`) when multiple panes share a name, e.g. `to_agent = "codex-primary"` instead of `"codex"`.

## Target selection

| `to_agent`           | `target_strategy` | Behavior                                                    |
| -------------------- | ----------------- | ----------------------------------------------------------- |
| `"agent-name"`       | `fixed` (default) | First pane match in `to_workspace` (by pane id)             |
| `"label"`            | `fixed`           | Label via `herdr agent rename`                              |
| `"codex"`            | `least_busy`      | Least-busy among `codex` matches **in `to_workspace` only** |
| `"least_busy"`       | — (legacy)        | Least-busy across **all** workspaces                        |
| `"least_busy:label"` | — (legacy)        | Least-busy with label filter, all workspaces                |

### Least-busy scoring

| State                                 | Base score |
| ------------------------------------- | ---------- |
| `idle`                                | 0          |
| `done`                                | 1          |
| `working`                             | 1          |
| `working` + custom-status `indexing`  | 1 + 2 = 3  |
| `working` + custom-status `building`  | 1 + 2 = 3  |
| `working` + custom-status `deploying` | 1 + 3 = 4  |
| `blocked`                             | excluded   |

Ties broken alphabetically by agent name.

## Commands

```bash
# Session inventory
herdr-orchestrator sessions

# Cross-session unified dashboard
herdr-orchestrator dashboard --sessions --verbose

# Validate rule references before running
herdr-orchestrator check-sessions

# Test rules without executing
herdr-orchestrator react --all --dry-run

# Execute all matching handoffs
herdr-orchestrator react --all --force-handoff
```

## Validation (`check-sessions`)

| Severity | Check                                         |
| -------- | --------------------------------------------- |
| ERROR    | `from_session` or `to_session` is not running |
| WARN     | Workspace not found in session                |
| WARN     | Agent/label doesn't resolve                   |
| INFO     | Agent has no session binding (restore: none)  |
| INFO     | Cross-session target supports native restore  |

## Detection authority

| Source                        | What it means                                                   |
| ----------------------------- | --------------------------------------------------------------- |
| `herdr:kimi`, `herdr:claude`  | Lifecycle-authoritative — status is fully trusted               |
| `herdr:codex`, `herdr:cursor` | Session identity only — restore support, screen-manifest status |
| `reported`                    | `pane report-agent` registered — no restore, no lifecycle       |
| `detected`                    | Screen manifest only — no session binding                       |

## Resume-aware handoff (future)

When Herdr preview ships `--resume`:

1. Source agent supports native restore → capture session ref, stop source, spawn target with `--resume <id>`
2. Source agent lacks restore → fall back to context-sync handoff (send last prompt)

Config option (optional): `handoff_strategy = "resume"` to require resume-aware transfer, failing the rule if unavailable.

## Example rules

### Intra-workspace (simplest)

```toml
[[herdr.orchestrator.handoff_rules]]
from_workspace = "w1"
from_agent = "test-agent"
condition = "done"
to_workspace = "w1"
to_agent = "kimi"
```

### Label-based (portable)

```toml
[[herdr.orchestrator.handoff_rules]]
from_workspace = "w1"
from_agent = "doctor-watch"
condition = "blocked > 5m"
to_workspace = "w1"
to_agent = "reviewer"
```

### Least-busy (dynamic)

```toml
[[herdr.orchestrator.handoff_rules]]
from_workspace = "w1"
from_agent = "test-agent"
condition = "done"
to_workspace = "w1"
to_agent = "least_busy"
```

### Cross-session (Phase 4)

```toml
[[herdr.orchestrator.handoff_rules]]
from_session = "dev"
from_workspace = "w1"
from_agent = "test-agent"
condition = "done"
to_session = "default"
to_workspace = "w0"
to_agent = "least_busy:reviewer"
```

### Probe-gated (canonical refs aligned)

```toml
[[herdr.orchestrator.handoff_rules]]
from_workspace = "wB"
from_agent = "kimi"
condition = "probe:canonical-references:runtime-aligned"
to_workspace = "wB"
to_agent = "codex-primary"
```

### Finish-work outcome (recommended for codex handoff)

```toml
# herdr agent rename wB:p6G codex-primary  # once per workspace
[[herdr.orchestrator.handoff_rules]]
from_workspace = "wB"
from_agent = "kimi"
to_workspace = "wB"
to_agent = "codex-primary"
when = { finishWorkReport.outcome = "clean", finishWorkReport.handoffCandidate.shouldHandoff = true }
```

### Cross-host staging fleet

```toml
[[herdr.orchestrator.handoff_rules]]
from_workspace = "wB"
from_agent = "kimi"
condition = "done"
to_session = "staging:default"
to_workspace = "staging"
to_agent = "codex"
target_strategy = "least_busy"
```

Handoffs fire after `bun run finish-work` persists `.kimi/finish-work-report.json` and `watch-events` runs context-sync + rule evaluation. Reviewer feedback is appended to the report and included in enriched handoff briefs on the next sync.

Dry-run: `herdr-orchestrator react --all --dry-run` evaluates probe checks against the project root.
