# kimi-toolchain

> Bun-native developer tooling: governance, diagnostics, security, and scaffolding
>
> `https://github.com/brendadeeznuts1111/kimi-toolchain`

**Quality (local):** `bun run lint` (`scripts/lint.ts`) includes **testing-docs** and **markdown-links** (`--full`, offline). Standalone: `bun run lint:links`, `bun run lint:links:online`. Primary enforcement is pre-commit/pre-push hooks and `bun run check`; `.github/workflows/ci.yml` runs on push/PR/schedule as a secondary gate.

## Install

```bash
# Global install (recommended)
bun install -g github:brendadeeznuts1111/kimi-toolchain
# ⚠️  Postinstall does NOT run automatically for GitHub sources.
# Run manually after global install:
kimi-toolchain setup
# Or if setup is unavailable:
bun run ~/.bun/install/global/node_modules/kimi-toolchain/src/install-hooks/postinstall.ts

# Or clone and link
git clone https://github.com/brendadeeznuts1111/kimi-toolchain.git ~/kimi-toolchain
cd ~/kimi-toolchain
bun install -g .
bun run unify    # sync → ~/.kimi-code/, install PATH wrappers, validate
```

**Cursor:** open `~/kimi-toolchain` or `kimi-toolchain.code-workspace` — not legacy `~/kimicode-cli`.

See **UNIFIED.md** for how Kimi Code (`kimi`), kimi-toolchain (`kimi-doctor`), and `~/.kimi-code/` relate.

## Artifact Portal (one-command demo)

Canvas, dashboard, serve-probe, and Herdr share one `BenchmarkApiEnvelope`. **One command** publishes diagnostics + a converged manifest to disk:

```bash
bun run build:portal:local                   # offline — recommended first run
bun run test:portal-convergence:fast         # quick smoke (~100ms)
```

Output: `.kimi/artifacts/artifact-portal/` (`benchmark-diagnostics` + `artifact-portal-manifest` with `convergedComponents: canvas, dashboard, herdr`).

| Consumer path     | Command                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Runnable example  | `bun run build:portal:local`                                                                                       |
| New workspace     | `bun create ./templates/bun-create/artifact-portal-convergence <name>`                                             |
| Convergence check | `test:portal-convergence:fast` (quick) or `test:portal-convergence` (full); `hooks:install` standalone slices only |

Walkthrough: [examples/artifact-portal.md](examples/artifact-portal.md). With dashboard: `PORT=5678 bun run dashboard` then `bun run build:portal` and `curl http://127.0.0.1:5678/api/effect-benchmark`.

## New project

```bash
kimi-new my-app              # mkdir + bun init -m -y + kimi-fix
cd my-app
bun run check:fast
kimi login
kimi-doctor --quick
```

**Zero-install alternative** — run any command without installing:

```bash
bunx github:brendadeeznuts1111/kimi-toolchain kimi-doctor
bunx github:brendadeeznuts1111/kimi-toolchain kimi-governance score
```

> See [Bun documentation](https://bun.com/docs/cli/bunx) for `bunx` usage.

## Commands

Curated entry points in **Core** and **Project Scripts** below. Full inventory is auto-maintained by `bun run docs:sync`.

<!-- readme-sync:begin -->

| Command                                 | Description                           |
| --------------------------------------- | ------------------------------------- |
| `bun run audit`                         | Audit script                          |
| `bun run audit:all`                     | Audit script                          |
| `bun run audit:config`                  | Audit script                          |
| `bun run audit:dry-run`                 | Audit script                          |
| `bun run audit:dry-run:parallel`        | Audit script                          |
| `bun run audit:hardcoded`               | Audit script                          |
| `bun run audit:images`                  | Audit script                          |
| `bun run audit:network`                 | Audit script                          |
| `bun run audit:parallel`                | Audit script                          |
| `bun run audit:perf`                    | Audit script                          |
| `bun run audit:secrets`                 | Audit script                          |
| `bun run autophagy:scan`                | scripts/autophagy-scan.ts             |
| `bun run autophagy:scan:gate`           | scripts/autophagy-scan.ts             |
| `bun run bench`                         | See package.json scripts              |
| `bun run build:portal`                  | Artifact Portal publish script        |
| `bun run build:portal:dry-run`          | Artifact Portal publish script        |
| `bun run build:portal:gate`             | Artifact Portal publish script        |
| `bun run build:portal:json`             | Artifact Portal publish script        |
| `bun run build:portal:local`            | Artifact Portal publish script        |
| `bun run build:portal:local:json`       | Artifact Portal publish script        |
| `bun run bun-install:status`            | scripts/bun-install-status.ts         |
| `bun run canvas:generate`               | scripts/generate-canvas-companions.ts |
| `bun run capabilities`                  | Run kimi-capabilities from repo       |
| `bun run check`                         | scripts/check.ts                      |
| `bun run check:dry-run`                 | Quality gate                          |
| `bun run check:env-drift`               | Quality gate                          |
| `bun run check:fast`                    | Quality gate                          |
| `bun run check:fast:changed`            | Quality gate                          |
| `bun run check:fast:skip-tests`         | Quality gate                          |
| `bun run check:lockfile`                | Quality gate                          |
| `bun run check:secret-leaks`            | Quality gate                          |
| `bun run check:secret-resolution`       | Quality gate                          |
| `bun run check:secrets-registry`        | Quality gate                          |
| `bun run check:secrets-storage-gate`    | Quality gate                          |
| `bun run check:staged`                  | Quality gate                          |
| `bun run check:template-policy`         | Quality gate                          |
| `bun run check:templates`               | Quality gate                          |
| `bun run check:watch`                   | Quality gate                          |
| `bun run check:watch:tests`             | Quality gate                          |
| `bun run ci:fast`                       | See package.json scripts              |
| `bun run ci:impact`                     | scripts/ci-impact.ts                  |
| `bun run ci:pipeline`                   | scripts/ci-pipeline.ts                |
| `bun run cleanup-legacy`                | Workspace / artifact cleanup          |
| `bun run cleanup:artifacts`             | Workspace / artifact cleanup          |
| `bun run cleanup:root`                  | Workspace / artifact cleanup          |
| `bun run cleanup:root:dry-run`          | Workspace / artifact cleanup          |
| `bun run cleanup:root:fix`              | Workspace / artifact cleanup          |
| `bun run config:status`                 | scripts/config-status.ts              |
| `bun run contract`                      | Run kimi-contract from repo           |
| `bun run cron:health`                   | scripts/cron-health.ts                |
| `bun run dashboard`                     | Run kimi-dashboard from repo          |
| `bun run dashboard-mcp`                 | Run kimi-dashboard-mcp from repo      |
| `bun run decision`                      | Run kimi-decision from repo           |
| `bun run deep-audit`                    | Run kimi-deep-audit from repo         |
| `bun run deep-audit:json`               | Run kimi-deep-audit from repo         |
| `bun run deep-audit:report`             | Run kimi-deep-audit from repo         |
| `bun run deep-audit:webview`            | Run kimi-deep-audit from repo         |
| `bun run discover`                      | scripts/discover.ts                   |
| `bun run discover:constants`            | scripts/discover.ts                   |
| `bun run discover:dx`                   | scripts/discover.ts                   |
| `bun run docs:sync`                     | scripts/readme-sync.ts                |
| `bun run doctor`                        | Run kimi-doctor from repo             |
| `bun run doctor:audit`                  | Doctor / deep-audit script            |
| `bun run doctor:audit:changed`          | Doctor / deep-audit script            |
| `bun run doctor:audit:ci`               | Doctor / deep-audit script            |
| `bun run doctor:audit:shard`            | Doctor / deep-audit script            |
| `bun run doctor:audit:watch`            | Doctor / deep-audit script            |
| `bun run doctor:audit:watch:changed`    | Doctor / deep-audit script            |
| `bun run dx:table`                      | scripts/dx-table.ts                   |
| `bun run dx:table:contract`             | scripts/dx-table-contract.ts          |
| `bun run error`                         | Run kimi-error from repo              |
| `bun run finish-work`                   | scripts/finish-work.ts                |
| `bun run fix`                           | Run kimi-fix from repo                |
| `bun run fix:drift`                     | See package.json scripts              |
| `bun run format`                        | See package.json scripts              |
| `bun run format:check`                  | See package.json scripts              |
| `bun run format:check:ci`               | See package.json scripts              |
| `bun run governance`                    | Run kimi-governance from repo         |
| `bun run heal`                          | Run kimi-heal from repo               |
| `bun run install-wrappers`              | scripts/install-bin-wrappers.ts       |
| `bun run kimi`                          | Run kimi-toolchain from repo          |
| `bun run lint`                          | scripts/lint.ts                       |
| `bun run lint:dashboard-visual`         | Lint script                           |
| `bun run lint:links`                    | Lint script                           |
| `bun run lint:links:full`               | Lint script                           |
| `bun run lint:links:online`             | Lint script                           |
| `bun run lint:parallel`                 | Lint script                           |
| `bun run lint:terms`                    | Lint script                           |
| `bun run mcp`                           | Run kimi-mcp from repo                |
| `bun run memory-budget`                 | Run kimi-doctor from repo             |
| `bun run memory-check`                  | scripts/memory-check.ts               |
| `bun run new`                           | Run kimi-new from repo                |
| `bun run pm:cache`                      | Bun package manager helper            |
| `bun run pm:cache:rm`                   | Bun package manager helper            |
| `bun run pm:hash`                       | Bun package manager helper            |
| `bun run pm:hash:print`                 | Bun package manager helper            |
| `bun run pm:hash:string`                | Bun package manager helper            |
| `bun run pm:ls`                         | Bun package manager helper            |
| `bun run pm:ls:all`                     | Bun package manager helper            |
| `bun run pm:outdated`                   | Bun package manager helper            |
| `bun run pm:outdated:json`              | Bun package manager helper            |
| `bun run pm:why`                        | Bun package manager helper            |
| `bun run postinstall`                   | Install hook — sets up ~/.kimi-code/  |
| `bun run profile`                       | scripts/profile.ts                    |
| `bun run push`                          | scripts/push.ts                       |
| `bun run quality:check:ci`              | scripts/lint-patterns.ts              |
| `bun run reclassify:failures`           | scripts/reclassify-failure-ledger.ts  |
| `bun run references:generate`           | Canonical references script           |
| `bun run references:inspect`            | Canonical references script           |
| `bun run references:inspect:watch`      | Canonical references script           |
| `bun run references:lint`               | Canonical references script           |
| `bun run references:lint-online`        | Canonical references script           |
| `bun run references:lint:examples`      | Canonical references script           |
| `bun run references:snapshot`           | Canonical references script           |
| `bun run runtime:deep`                  | scripts/runtime-info.ts               |
| `bun run runtime:info`                  | scripts/runtime-info.ts               |
| `bun run scope:run`                     | scripts/scope-run.ts                  |
| `bun run secrets:gate`                  | scripts/secrets-storage-gate.ts       |
| `bun run serve-probe`                   | Run kimi-doctor from repo             |
| `bun run setup`                         | See package.json scripts              |
| `bun run skills:table`                  | scripts/skills-table.ts               |
| `bun run sync`                          | Runtime sync script                   |
| `bun run sync:check`                    | Runtime sync script                   |
| `bun run sync:cursor-canvases`          | Runtime sync script                   |
| `bun run sync:daemon`                   | Runtime sync script                   |
| `bun run sync:manifest`                 | Runtime sync script                   |
| `bun run sync:verify`                   | Runtime sync script                   |
| `bun run test`                          | scripts/test-run.ts                   |
| `bun run test:changed`                  | Test tier script                      |
| `bun run test:changed:push`             | Test tier script                      |
| `bun run test:changed:shard`            | Test tier script                      |
| `bun run test:changed:watch`            | Test tier script                      |
| `bun run test:ci`                       | Test tier script                      |
| `bun run test:coverage`                 | Test tier script                      |
| `bun run test:coverage:ci`              | Test tier script                      |
| `bun run test:coverage:fast`            | Test tier script                      |
| `bun run test:debug`                    | Test tier script                      |
| `bun run test:fast`                     | Test tier script                      |
| `bun run test:gates`                    | Test tier script                      |
| `bun run test:integration`              | Test tier script                      |
| `bun run test:parallel`                 | Test tier script                      |
| `bun run test:portal-convergence`       | Test tier script                      |
| `bun run test:portal-convergence:fast`  | Test tier script                      |
| `bun run test:portal-convergence:watch` | Test tier script                      |
| `bun run test:shard`                    | Test tier script                      |
| `bun run test:smoke`                    | Test tier script                      |
| `bun run test:smol`                     | Test tier script                      |
| `bun run test:unit`                     | Test tier script                      |
| `bun run test:watch`                    | Test tier script                      |
| `bun run toolchain`                     | Run kimi-toolchain from repo          |
| `bun run trace`                         | Run kimi-trace from repo              |
| `bun run typecheck`                     | See package.json scripts              |
| `bun run unify`                         | scripts/unify.ts                      |
| `bun run verify-workspace`              | scripts/verify-workspace.ts           |
| `bun run verify:bun-features`           | scripts/verify-bun-features.ts        |
| `bun run verify:bun-features:strict`    | scripts/verify-bun-features.ts        |
| `bun run why`                           | Run kimi-why from repo                |

<!-- readme-sync:end -->

### Core

| Command                        | Description                                    |
| ------------------------------ | ---------------------------------------------- |
| `kimi-doctor`                  | Full toolchain diagnostics                     |
| `kimi-new <name> [--path dir]` | Create project (`bun init -m -y` + `kimi-fix`) |
| `kimi-fix <path> [--dry-run]`  | Auto-repair project scaffolding                |
| `kimi-fix doctor [path]`       | Check scaffold completeness                    |

### Project Scripts

| Command                                | Description                                                        |
| -------------------------------------- | ------------------------------------------------------------------ |
| `bun run doctor`                       | Run kimi-doctor from repo                                          |
| `bun run kimi`                         | Run the local kimi-toolchain router from repo                      |
| `bun run fix`                          | Run kimi-fix from repo                                             |
| `bun run new`                          | Run kimi-new from repo                                             |
| `bun run governance`                   | Run kimi-governance from repo                                      |
| `bun run test`                         | Full suite: unit → integration → smoke (`test-run.ts`)             |
| `bun run test:fast`                    | Unit gate only (`UNIT_TEST_FILES`, 30s, `--parallel=4 --isolate`)  |
| `bun test <file>`                      | Single-file debug (bare Bun discovery)                             |
| `bun test --coverage`                  | Coverage probe without tier wrapper                                |
| `bun test --parallel`                  | Full suite across all cores                                        |
| `bun test --parallel=4`                | Full suite across 4 workers                                        |
| `bun test --shard=1/3`                 | CI sharding (`--parallel --shard <M/N>`)                           |
| `bun run test:changed`                 | Only tests impacted by uncommitted changes                         |
| `bun run test:changed:watch`           | Changed tests watcher                                              |
| `bun run test:coverage`                | Full suite with Bun coverage report                                |
| `bun run test:coverage:fast`           | Unit coverage at the fast timeout (R-Score gate)                   |
| `bun run test:coverage:ci`             | Full suite + coverage (60s timeout, lcov, `--bail`)                |
| `bun run check`                        | format:check + lint + typecheck + test (CI/full)                   |
| `bun run check:fast`                   | Same gates; unit tests (`--parallel=4 --isolate`)                  |
| `bun run check:dry-run`                | List check steps without running them                              |
| `bun run docs:sync`                    | Regenerate README script inventory from package.json               |
| `bun run typecheck`                    | TypeScript type check (no emit)                                    |
| `bun run format`                       | Format with oxfmt (write)                                          |
| `bun run format:check`                 | Verify formatting (CI gate)                                        |
| `bun run format:check:ci`              | Format check with `--threads=4` (GitHub Actions)                   |
| `bun run lint`                         | Lint with oxlint + banned-terms scan                               |
| `bun run lint:terms`                   | Scan docs for banned internal branding tags                        |
| `bun run sync`                         | Sync repo to `~/.kimi-code/`                                       |
| `bun run sync:manifest`                | Generate `~/.kimi-code/toolchain-manifest.json`                    |
| `bun run build:portal`                 | Publish Artifact Portal (probe first, local-loop fallback)         |
| `bun run build:portal:local`           | Offline portal publish (`--local-only`)                            |
| `bun run build:portal:json`            | Machine-readable build report (probe-first)                        |
| `bun run build:portal:local:json`      | Offline publish + JSON (pre-push guard / automation)               |
| `bun run test:portal-convergence`      | Full convergence smoke (serve-probe mock + local-loop integration) |
| `bun run test:portal-convergence:fast` | Mocked serve-probe test only (~100ms)                              |
| `bun run sync:verify`                  | Verify sync manifest hashes and desktop drift                      |
| `bun run sync:daemon`                  | Sync on cron (every 5 min)                                         |
| `bun run unify`                        | Sync runtime, wrappers, validate                                   |
| `bun run install-wrappers`             | Install `~/.local/bin/kimi-*` wrappers                             |
| `bun run memory-check`                 | Shell memory pressure snapshot                                     |
| `bun run memory-budget`                | Per-app RSS breakdown via kimi-doctor                              |

### Effect CI impact rules

`bun run ci:pipeline --affected` builds an Effect graph from `ci/impact.config.json` and the import dependency graph. `docsOnly` changes run only `success-metrics` and fast governance. `configOnly` changes are for CI metadata and env examples and also use the minimal graph. Source changes run the combined `quality` gate, typecheck, and only the tests, smoke checks, benchmarks, and security scan affected by the changed files. Unknown risky source files intentionally fall back to the full graph.

When updating `ci/impact.config.json`, put runtime-impacting files in `fullRun`, pure CI metadata in `configOnly`, and source ownership in `targets`. JSON does not allow comments, so policy notes live in the top-level `notes` field.

Generated test, report, coverage, and temp-home outputs are written under `.kimi-artifacts/`. That directory is ignored and is the only supported local artifact root for CI/test outputs.

### Sync Manifest

`bun run sync` copies managed files to `~/.kimi-code/` and regenerates `~/.kimi-code/toolchain-manifest.json` with sha256 hashes for every sync-managed source. `bun run sync:verify` recomputes those hashes and compares them with both the manifest and the live desktop copy. The managed pre-push hook skips no-op/delete-only pushes, otherwise runs the fast local gate by default, then runs `sync` followed by `sync:verify`; set `KIMI_PRE_PUSH_FULL=1` when a push should run the full local gate.

### Introspection & Self-Healing

The toolchain stores local causal telemetry under `~/.kimi-code/var/` and keeps apply behavior guarded.
When an agent needs to understand a failure chain, run `kimi-trace <trace-id> --json`.
When it needs to know whether integrations are alive, run `kimi-capabilities --json`.
When contracts or provider declarations change, run `kimi-contract validate --json` before trusting them.

Smoke-check the introspection surface from a working tree:

```bash
bun run capabilities --json | grep '"readiness"'
bun run kimi contract validate ./contracts/sample.contract.json --json | grep '"trusted"'
```

| Command                         | Description                                                   |
| ------------------------------- | ------------------------------------------------------------- |
| `kimi-capabilities --json`      | Run live MCP, hook, credential, and contract readiness probes |
| `kimi-capabilities --trend`     | Show saved capability snapshots over time                     |
| `kimi-trace <trace-id> --json`  | Reconstruct a causal graph and root-cause chain               |
| `kimi-contract validate --json` | Audit signed/unsigned/unknown/invalid contracts               |
| `kimi-contract sign <file>`     | Sign a normalized JSON/YAML contract with an Ed25519 key      |
| `kimi-heal plan --json`         | Convert capabilities and failure clusters into an action plan |
| `kimi-heal apply --dry-run`     | Preview safe healing actions without mutating state           |
| `kimi-heal apply --yes`         | Apply only actions marked `safeToAutoApply`                   |
| `kimi-decision log --json`      | List recorded decisions from the decision ledger              |
| `kimi-why <topic> --json`       | Explain recorded decisions; alias for `kimi-decision why`     |

Effect-native agents can skip subprocesses and compose the same surface through
`KimiIntrospectionLive`; see [docs/agent-api.md](docs/agent-api.md).

`kimi-heal apply` is dry-run by default. Manual or blocked actions, including lockfile trust baselines, dependency installs, signing keys, and source edits, are surfaced but not applied automatically.

#### Local Schemas

| File / object                            | Purpose                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `~/.kimi-code/var/tool-failures.jsonl`   | Classified failures with `taxonomyId`, trace fields, and context       |
| `~/.kimi-code/var/trace-events.jsonl`    | `TraceEvent` records for CLI, subprocess, hook, and MCP activity       |
| `~/.kimi-code/var/capabilities/*.json`   | `CapabilityReport` snapshots with readiness score and per-check status |
| `<contract>.sig`                         | Ed25519 `ContractSignatureEnvelope` for a normalized contract          |
| `trusted-keys.json`                      | Project trusted public keys and optional roles                         |
| `~/.kimi-code/var/decision-ledger.jsonl` | `DecisionRecord` entries for `kimi-decision` and `kimi-why`            |
| `HealPlan` / `HealApplyReport`           | `kimi-heal` planning/apply output schemas                              |

#### JSON Shapes

`kimi-capabilities --json` writes a `CapabilityReport` and saves the same shape under `~/.kimi-code/var/capabilities/`:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-06-15T00:00:00.000Z",
  "readiness": 75,
  "readinessScore": 75,
  "healthy": 3,
  "degraded": 1,
  "unavailable": 0,
  "checks": [
    {
      "id": "contract-trust",
      "type": "contract",
      "status": "degraded",
      "summary": "0 trusted, 2 unsigned, 0 unknown-key, 0 invalid",
      "latencyMs": 4,
      "lastSuccessfulContact": "2026-06-15T00:00:00.000Z",
      "details": { "unsigned": 2 }
    }
  ]
}
```

`kimi-trace <trace-id> --json` returns a trace graph:

```json
{
  "rootTraceId": "root-123",
  "requestedTraceId": "child-456",
  "found": true,
  "rootCauseChain": ["root-123", "child-456"],
  "nodes": [
    {
      "traceId": "child-456",
      "parentTraceId": "root-123",
      "childTraceIds": [],
      "status": "error",
      "durationMs": 128,
      "events": [],
      "failures": [{ "taxonomyId": "lockfile_issue" }]
    }
  ]
}
```

Contracts are normalized before signing. Sibling signatures are preferred; embedded `x-kimi-signature` fields are ignored during normalization so a future embedded form can be validated against the same payload.

```json
{
  "schemaVersion": 1,
  "algorithm": "ed25519",
  "keyId": "schema-team",
  "signatureHex": "0123abcd",
  "payloadSha256": "64-character-sha256-hex",
  "signedAt": "2026-06-15T00:00:00.000Z"
}
```

`trusted-keys.json` may be either a direct key map or a `{ "keys": { ... } }` wrapper:

```json
{
  "keys": {
    "schema-team": {
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "roles": ["schema", "provider-contracts"]
    }
  }
}
```

### Governance

| Command                         | Description                                  |
| ------------------------------- | -------------------------------------------- |
| `kimi-governance score`         | Compute R-Score for current project          |
| `kimi-governance fix`           | Auto-generate missing governance files       |
| `kimi-governance coverage [N]`  | Test coverage gate (threshold %, default 70) |
| `kimi-governance docs`          | Detect README ↔ package.json script drift    |
| `kimi-governance adr "<title>"` | Scaffold a new ADR in `docs/adr/`            |

### Security

| Command                         | Description                                 |
| ------------------------------- | ------------------------------------------- |
| `kimi-guardian check`           | Lockfile integrity & CVE scan               |
| `kimi-guardian sign`            | Baseline lockfile hash                      |
| `kimi-guardian verify`          | Verify lockfile against stored hash         |
| `kimi-cloudflare-access login`  | Store Cloudflare credentials in OS keychain |
| `kimi-cloudflare-access logout` | Remove stored Cloudflare credentials        |
| `kimi-cloudflare-access`        | Service token expiry sweep                  |
| `kimi-cloudflare-access apps`   | Access application policy audit             |
| `kimi-cloudflare-access fix`    | Rotate expired/expiring Cloudflare tokens   |

### Memory & Sessions

| Command                                 | Description                             |
| --------------------------------------- | --------------------------------------- |
| `kimi-memory doctor`                    | Session store health check              |
| `kimi-memory trends`                    | Persistent warning tracking across runs |
| `kimi-memory store <id> [decisions...]` | Save a session snapshot                 |
| `kimi-memory recall [limit]`            | Show recent sessions                    |
| `kimi-memory resume`                    | Check if last session is stale          |
| `kimi-memory autosave [start\|stop]`    | Auto-save every 30s                     |
| `kimi-memory graph`                     | Show project knowledge graph            |
| `kimi-memory impact <node-id>`          | Cross-project impact analysis           |
| `kimi-memory search <query>`            | Search knowledge nodes                  |
| `kimi-memory prune [days]`              | Remove old sessions (default 30)        |

### Git Hooks

| Command                 | Description                         |
| ----------------------- | ----------------------------------- |
| `kimi-githooks install` | Install pre-commit + pre-push hooks |
| `kimi-githooks doctor`  | Check hook installation health      |
| `kimi-githooks fix`     | Re-install missing/outdated hooks   |

### Context & Release

| Command                      | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `kimi-context-gen scan`      | Scan project and generate CONTEXT.md         |
| `kimi-context-gen update`    | Regenerate CONTEXT.md                        |
| `kimi-context-gen freshness` | Check if CONTEXT.md is stale                 |
| `kimi-release changelog`     | Generate changelog from conventional commits |
| `kimi-release semver`        | Compute next semantic version                |
| `kimi-release validate`      | Validate commit message format               |

### Resource Governor

| Command                              | Description                      |
| ------------------------------------ | -------------------------------- |
| `kimi-resource-governor limits`      | Show current resource limits     |
| `kimi-resource-governor parallel`    | Show parallel execution slots    |
| `kimi-resource-governor spawn <cmd>` | Run command with resource limits |
| `kimi-resource-governor cache`       | Show diagnostic cache status     |
| `kimi-resource-governor status`      | Overall governor status          |

### Debug

| Command              | Description               |
| -------------------- | ------------------------- |
| `kimi-debug last`    | Show last failure         |
| `kimi-debug diff`    | Compare last two failures |
| `kimi-debug trace`   | Trace execution path      |
| `kimi-debug analyze` | Analyze failure pattern   |

### Snapshot

| Command                        | Description               |
| ------------------------------ | ------------------------- |
| `kimi-snapshot save`           | Save environment snapshot |
| `kimi-snapshot restore <id>`   | Restore from snapshot     |
| `kimi-snapshot list`           | List available snapshots  |
| `kimi-snapshot show <id>`      | Show snapshot details     |
| `kimi-snapshot cleanup [days]` | Remove old snapshots      |

## Project Structure

```
src/
  bin/          # CLI tools (kimi-doctor, kimi-governance, etc.)
  lib/          # Shared utilities (utils.ts)
  install-hooks/# postinstall.ts (bun package hook)
  kimi-hooks/   # Kimi Code lifecycle hooks (PostToolUseFailure, etc.)
  guardian/     # Lockfile verifier
  drift/        # Dependency drift detector
```

Live runtime at `~/.kimi-code/` (managed by postinstall hook).

## Governance

- R-Score: run `kimi-governance score`
- License: MIT
- [CONTRIBUTING.md](./CONTRIBUTING.md)

### Success Metrics

These goals define whether the toolchain is doing its job. They are checked by
`kimi-doctor --success-metrics` and are part of `bun run check`, so CI gets a
clear pass/fail on every commit.

**Drift latency**
: Any single documented behaviour, such as a README command, API sample, or CLI
help example, must be verified against the live system in one `kimi doctor`
or `kimi-doctor` run. The current automated check verifies README command
drift against `package.json` without manual inspection.

**Error coverage**
: At least 90% of failures from managed contracts, hooks, and integrations must
receive a taxonomy code and structured context containing stack, inputs, and
environment details. The remaining failures stay in a monitored
`unknown` bucket until the taxonomy is expanded.

**Integration agility**
: A new cloud provider must require only two artifacts: a contract declaration
for shape, permissions, and error categories, plus a thin credential adapter
that maps `getSecret(scope) -> string` into a short-lived token. The scheduler,
contract engine, taxonomy schema, and existing providers stay provider-agnostic.

The metrics are not frozen. As the toolchain learns, the taxonomy may expand,
the definition of core logic may tighten, and new metrics may emerge from the
failure ledger. This section is updated on the same release cadence as the
toolchain, and any threshold change must include a justification linked to real
data from `~/.kimi-code/var/tool-failures.jsonl`.

## Cloudflare API Token Setup

The `kimi-cloudflare-access` tool reads credentials from `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` environment variables, or from the OS keychain via `kimi-cloudflare-access login`.

### Required token permissions

Create a dedicated API token at https://dash.cloudflare.com/profile/api-tokens with these permissions:

| Permission             | Commands                      |
| ---------------------- | ----------------------------- |
| Account > Access: Read | `tokens`, `apps`, `doctor`    |
| Account > Access: Edit | `fix` (rotate service tokens) |

### Login / logout

```bash
# Interactively store credentials in the OS keychain
kimi-cloudflare-access login

# Remove stored credentials
kimi-cloudflare-access logout
```

Credentials are stored with `Bun.secrets` under the service name `kimi-toolchain`. The first run may prompt for keychain access.

### CI / env-var override

For CI or non-TTY environments, set environment variables instead of using `login`:

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-api-token"
kimi-cloudflare-access doctor
```

Environment variables take precedence over stored credentials.

### Auth compatibility

Wrangler OAuth tokens and the Kimi Code Cloudflare MCP server authenticate through separate flows. They cannot be used by this CLI. Use a dedicated Cloudflare API token with the permissions above.

## Safety

- No secrets in source. Use `Bun.env` or `Bun.secrets`.
- Validate all external input at system boundaries.
