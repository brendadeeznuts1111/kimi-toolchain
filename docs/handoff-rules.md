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
to_agent = "least_busy:reviewer"  # agent/label, "least_busy", or "least_busy:<label>"
```

## Condition syntax

| Syntax | Meaning |
|--------|---------|
| `done` | Agent is in "done" state |
| `blocked > Nm` | Agent has been blocked for N+ minutes |
| `idle > Nm` | Agent has been idle for N+ minutes |
| `probe:canonical-references:runtime-aligned` | `~/.kimi-code/canonical-references.json` matches repo (fix: `bun run sync`) |
| `probe:canonical-references:repo-fresh` | Repo manifest matches `src/lib/canonical-references.ts` (fix: `bun run references:generate`) |
| `probe:canonical-references:runtime-cache` | Runtime cache file exists at `~/.kimi-code/` |

Status conditions use orchestrator state timestamps (`.kimi/herdr-orchestrator-state.json`).
Probe conditions call `auditCanonicalReferencesHealth` — agent status is not required.

## Target selection

| `to_agent` value | Behavior |
|------------------|----------|
| `"agent-name"` | Direct agent name match |
| `"label"` | Label set via `herdr agent rename` — resolves to agent |
| `"least_busy"` | Picks the least-busy agent across all workspaces (idle > done > working, blocked excluded) |
| `"least_busy:label"` | Picks the least-busy agent matching the given label |

### Least-busy scoring

| State | Base score |
|-------|-----------|
| `idle` | 0 |
| `done` | 1 |
| `working` | 1 |
| `working` + custom-status `indexing` | 1 + 2 = 3 |
| `working` + custom-status `building` | 1 + 2 = 3 |
| `working` + custom-status `deploying` | 1 + 3 = 4 |
| `blocked` | excluded |

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

| Severity | Check |
|----------|-------|
| ERROR | `from_session` or `to_session` is not running |
| WARN | Workspace not found in session |
| WARN | Agent/label doesn't resolve |
| INFO | Agent has no session binding (restore: none) |
| INFO | Cross-session target supports native restore |

## Detection authority

| Source | What it means |
|--------|---------------|
| `herdr:kimi`, `herdr:claude` | Lifecycle-authoritative — status is fully trusted |
| `herdr:codex`, `herdr:cursor` | Session identity only — restore support, screen-manifest status |
| `reported` | `pane report-agent` registered — no restore, no lifecycle |
| `detected` | Screen manifest only — no session binding |

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
to_agent = "codex"
```

Dry-run: `herdr-orchestrator react --all --dry-run` evaluates probe checks against the project root.
