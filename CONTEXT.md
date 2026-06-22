---
title: "CONTEXT"
tags: [root]
category: root
status: draft
priority: medium
---
# CONTEXT — kimi-toolchain

> `https://github.com/brendadeeznuts1111/kimi-toolchain`

## Domain

Bun-native extension layer for Kimi Code and project governance. This repo provides diagnostics, MCP bridge provisioning, scaffolding, causal tracing, capability probes, signed contract validation, and safe self-healing plans synced into `~/.kimi-code/` — it does not replace the official Moonshot `kimi` agent (see UNIFIED.md for Kimi Work vs Kimi Code vs kimi-toolchain).

## Architecture

### Repo Structure (source of truth)

```
kimi-toolchain/
  src/
    bin/              # CLI entry points (git-tracked)
      ├── kimi-doctor.ts
      ├── kimi-governance.ts
      ├── kimi-guardian.ts
      ├── kimi-memory.ts
      ├── kimi-githooks.ts
      ├── kimi-context-gen.ts
      ├── kimi-debug.ts
      ├── kimi-resource-governor.ts
      ├── kimi-release.ts
      ├── kimi-snapshot.ts
      ├── kimi-trace.ts
      ├── kimi-capabilities.ts
      ├── kimi-contract.ts
      ├── kimi-decision.ts
      ├── kimi-heal.ts
      ├── kimi-why.ts
      └── unified-shell-bridge.ts
    lib/
      ├── utils.ts    # Shared utilities (was kimi-utils.ts)
      ├── trace-ledger.ts
      ├── capabilities.ts
      ├── contract-signing.ts
      ├── error-clustering.ts
      ├── self-healing.ts
      └── decision-ledger.ts
    install-hooks/
      └── postinstall.ts   # Sets up ~/.kimi-code/ on install (bun package hook)
    kimi-hooks/
      └── log-tool-failure.ts  # Kimi Code PostToolUseFailure handler
    guardian/
      └── verify.ts        # Lockfile integrity
    drift/
      └── check.ts         # Dependency drift
```

### Live Runtime (managed by postinstall)

```
~/.kimi-code/
  tools/              # Copied from src/bin/ on install
  lib/                # Copied from src/lib/ on install
  scripts/            # Copied gate scripts
  mcp.json            # User MCP (toolchain seeds unified-shell)
  skills/             # Kimi Code user skills
  var/                # Toolchain sessions.db (not Kimi sessions/)
  var/tool-failures.jsonl
  var/trace-events.jsonl
  var/decision-ledger.jsonl
  var/capabilities/*.json
  guardian/           # Lockfile manifests
  governor/           # Resource cache
  AGENTS.md           # Copied from repo
  CODE_REFERENCES.md  # Copied from repo
  UNIFIED.md          # Copied from repo
  TEMPLATES.md        # Copied from repo
```

## Tech Stack

| Layer    | Choice              |
| -------- | ------------------- |
| Runtime  | Bun >=1.3.14        |
| Language | TypeScript          |
| Database | SQLite (bun:sqlite) |
| Config   | TOML (bunfig.toml)  |
| Deps     | effect, js-yaml     |

## Commands

```bash
# Install globally
bun install -g github:brendadeeznuts1111/kimi-toolchain

# Quality gates
kimi-doctor              # Full toolchain diagnostics
kimi-fix                 # Auto-repair gaps
kimi-guardian check      # Lockfile + CVE scan
kimi-governance score    # Compute R-Score
kimi-governance fix      # Generate missing files

# Session & memory
kimi-memory doctor       # DB health check
kimi-memory trends       # Persistent warnings
kimi-memory autosave start

# Git hooks
kimi-githooks install    # Install pre-commit + pre-push
bun run sync             # Sync repo-managed runtime files
bun run sync:verify      # Verify sync manifest hashes and desktop drift

# Context
kimi-context-gen update  # Regenerate CONTEXT.md

# Introspection and trust
kimi-capabilities --json      # Live readiness probes + snapshots
kimi-trace <trace-id> --json  # Causal graph and root-cause chain
kimi-contract validate --json # Contract signature trust audit
kimi-heal plan --json         # Safe/manual/blocked healing actions
kimi-heal apply --dry-run     # Non-mutating apply preview
kimi-decision log --json      # List prior decisions
kimi-why <topic> --json       # Explain prior decisions; alias for decision why
```

## Governance

| Check           | Status  |
| --------------- | ------- |
| License         | MIT     |
| CONTRIBUTING.md | present |
| CODEOWNERS      | present |
| README.md       | present |
| CHANGELOG.md    | present |
| CONTEXT.md      | present |

## Success Metrics

These are enforced by `kimi-doctor --success-metrics` and `bun run check`.

| Metric                    | Contract                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drift latency**         | One `kimi doctor` or `kimi-doctor` run must produce a pass/fail for documented command drift with no manual inspection.                      |
| **Error coverage**        | >= 90% of managed contract, hook, and integration failures must classify to taxonomy ids with stack, inputs, environment, and trace context. |
| **Integration agility**   | New cloud providers require only a contract declaration and a thin credential adapter using `getSecret(scope) -> string`.                    |
| **Agent context quality** | Agent-facing docs, skill metadata, generated scaffolds, and guardrails must score >= 92/100, a 15% lift over the 80-point baseline.          |

The metrics are not frozen. As the toolchain learns, the taxonomy may expand,
the definition of core logic may tighten, and new metrics may emerge from the
failure ledger. The metrics section follows the toolchain release cadence, and
threshold changes require justification linked to real ledger data.

## Agent References

- `AGENTS.md` — operating rules for future agents
- `CODE_REFERENCES.md` — local exemplar map for Effect, tool runner, logging, config/schema, packages, tests, and Cloudflare/MCP boundaries
- `UNIFIED.md` — Kimi Code vs kimi-toolchain vs DX/MCP product map
- `TEMPLATES.md` — scaffold templates and generated AGENTS.md reference
- `skills/kimi-toolchain/SKILL.md` — agent workflow for diagnostics, traces, capability probing, self-healing, contracts, and governance
- `src/lib/agent-context-quality.ts` — measurable contract for the 15% agent context and skill quality lift
- `docs/agent-api.md` — Effect service descriptor for `KimiIntrospectionLive`, `KimiCapabilities`, `KimiTrace`, `KimiContract`, and `DecisionLoggerLive`

## Toolchain Context Map

| Surface             | Run When                                        | JSON Anchor                                                       |
| ------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `kimi-capabilities` | Check MCP, hook, credential, contract readiness | `CapabilityReport.readiness`, `readinessScore`, `checks[].status` |
| `kimi-trace`        | Explain nested subprocess/hook/MCP failures     | `TraceGraph.rootCauseChain`, `nodes[].failures[]`                 |
| `kimi-contract`     | Sign or validate declarative contracts          | `ContractSignatureEnvelope`, `ContractValidationResult`           |
| `kimi-heal`         | Convert surfaced failures into repair options   | `HealPlan.actions[].safeToAutoApply`, `HealApplyReport`           |
| `kimi-decision`     | List or record previous toolchain decisions     | `DecisionRecord.decisionId`, `DecisionRecord.rationale`           |
| `kimi-why`          | Explain previous toolchain decisions            | `DecisionRecord.rationale`, `DecisionExplanation.rootCauseChain`  |

Agent default: run `kimi-capabilities --json` before deeper debugging, `kimi-trace <trace-id> --json` when a trace id is present, and `kimi-contract validate --json` before trusting changed provider or schema contracts.
Effect-native agents can compose the same surface without subprocesses through `KimiIntrospectionLive` from `src/lib/effect/kimi-introspection-services.ts` and `DecisionLoggerLive` from `src/lib/decision-ledger.ts`.

## Generated Artifacts

- Repo-local generated outputs live under `.kimi-artifacts/`.
- Bun coverage writes to `.kimi-artifacts/coverage`; JUnit reports write to `.kimi-artifacts/reports`; temp HOME and disposable markers write to `.kimi-artifacts/tmp` or `.kimi-artifacts/test-home`.
- `bun run sync` regenerates `~/.kimi-code/toolchain-manifest.json` with sha256 hashes for sync-managed files.
- `bun run sync:verify` compares current repo hashes, the manifest, and the live desktop copy; the managed pre-push hook runs it after sync.

## Introspection Schemas

- Failure ledger: append-only `~/.kimi-code/var/tool-failures.jsonl` with `schemaVersion`, `taxonomyId`, legacy `categoryId`, trace fields, and structured context.
- Trace ledger: append-only `~/.kimi-code/var/trace-events.jsonl` with `TraceEvent` records: `traceId`, `parentTraceId`, `childTraceIds`, `eventType`, `tool`, `status`, timing, command/cwd, and metadata.
- Capability snapshots: JSON reports under `~/.kimi-code/var/capabilities/` with `schemaVersion`, `readiness`, `readinessScore`, healthy/degraded/unavailable counts, and `checks[]` with `id`, `type`, `status`, `summary`, `latencyMs`, and optional details.
- Contract signatures: sibling `<contract>.sig` files using Ed25519 `ContractSignatureEnvelope` values. Embedded `x-kimi-signature` fields are stripped from the normalized payload. Project trust roots live in `trusted-keys.json` as either a direct key map or `{ "keys": { "<key-id>": { "publicKey": "...", "roles": [] } } }`.
- Heal plans: `HealPlan` / `HealApplyReport` values from `kimi-heal`; apply is dry-run by default and only runs `safeToAutoApply` actions with `--yes`.
- Decision ledger: append-only `~/.kimi-code/var/decision-ledger.jsonl` records used by `kimi-decision` and `kimi-why`, with canonical `decisionId`, `actor`, `action`, `trigger`, optional `clusterId`, `rationale`, `alternativesConsidered`, `outcome`, trace fields, and parent/child decision links.

## Decisions

No ADRs yet. Create one: `kimi-governance adr "<title>"`

## Port Policy

- Default to `0` for auto-assignment. Log actual port on startup.
- Never hardcode ports in source.

## Safety

- No secrets in source. Use `Bun.env` or `Bun.secrets`.
- Validate all external input at system boundaries.

## Notes

- This is a meta-project: it manages the tools that manage other projects.
- Future agents should read `CODE_REFERENCES.md` before adding new modules or packages.
- Future agents should run `kimi-heal plan --json` after surfaced failures and treat manual/blocked actions as human-reviewed work.
- All tools are Bun-native: use `Bun.file`, `Bun.spawn`, `Bun.hash`, etc.
- Shared utilities in `src/lib/utils.ts` — import from there, don't duplicate.
- Live runtime at `~/.kimi-code/` is managed by `postinstall.ts` — don't edit manually.
- Run `kimi-doctor` for full toolchain diagnostics

---

_Auto-generated by kimi-context-gen. Updated manually._
## Related

- [INDEX.md](../INDEX.md) — Documentation index
