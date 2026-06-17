# Phase 5 Config Lifecycle Plan

Date: 2026-06-15
Branch: `feat/config-lifecycle-5.x`
Scope: docs/spec first; implementation waits until Phase 3.1.x operator polish and Phase 4 predictive doctor settle.

## Goal

Move `[define]` constants from static golden repair into a managed lifecycle:

- validate current and proposed constant values
- explain drift, impact, and timeline
- simulate canary/A-B candidates through `TestConstants`
- gate real `bunfig.toml` writes behind explicit approval
- use Phase 4 health snapshots as the rollback signal

This phase must not pretend build-time `[define]` constants can route live traffic. Canary and A-B are local validation workflows until a future runtime config layer exists.

## Grounding

Existing foundations:

- `src/lib/constants-heal.ts` owns golden capture, repair, archive, restore, drift acceptance, repair dedupe, and impact preview.
- `src/lib/constants-registry.ts` owns schemas, validation, live values, and `TestConstants(projectRoot, overrides)`.
- `src/lib/decision-ledger.ts` records `constant-repair` and `constant-drift-accept` decisions.
- `src/lib/taxonomy-constants.ts` maps constants to taxonomy categories and active failure context.
- Phase 4 adds `.kimi/var/health.ndjson` and predictive health history for rollback decisions.

Implementation should add a new `kimi-config` CLI rather than overloading `kimi-heal`. `kimi-heal` remains recovery-oriented; `kimi-config` becomes the lifecycle/operator surface.

## CLI Contract

### Read-only commands

`kimi-config diff --from golden --to current --impact [--json]`

- Uses the existing golden diff and impact machinery.
- Human output mirrors `kimi-heal repair-constants --dry-run --impact`.
- JSON includes schema version, diff, validation issues, golden version, impact, and suggested next command.

`kimi-config validate [--json]`

- Validates all current `[define]` values against `types/build-constants.d.ts`.
- Adds cross-constant rules in a small local rule registry.
- First rules:
  - retry budget sanity: timeout-like values must not exceed retry-delay-like values times retry counts when those constants exist
  - positive integer enforcement remains schema-owned
  - unknown constants are warn, invalid known constants are error

`kimi-config timeline --constant <key> [--last 30d] [--json]`

- Reads decision ledger and golden archive metadata.
- Shows repair, accept-drift, proposed rollout, rollback, and validation decisions touching the key.
- Does not require the current value to be drifted.

### Proposal commands

`kimi-config canary --constant <key> --value <value> --percent <n> [--suite <name>] [--json]`

- Validates the proposed value against the constant schema.
- Creates a proposal record under `.kimi/var/config-lifecycle.ndjson`.
- Runs the selected local validation suite through `TestConstants(projectRoot, { [key]: value })`.
- `--percent` is recorded as rollout intent only; no live traffic is routed.
- Without `--yes`, this is proposal-only and never writes `bunfig.toml`.

`kimi-config ab --constant <key> --a <value> --b <value> --duration <window> [--suite <name>] [--json]`

- Validates both values.
- Runs the same suite once per variant through `TestConstants`.
- Emits a deterministic comparison: pass/fail counts, health score delta where available, and recommendation.
- `--duration` is recorded as experiment intent unless a future harness runner provides repeated sampling.

### Mutation commands

`kimi-config apply <proposal-id> --yes [--message <text>] [--json]`

- Requires a proposal that passed validation.
- Rewrites only the targeted `[define]` line(s) in `bunfig.toml`.
- Archives the prior golden when appropriate.
- Logs a `config-change` decision with metadata type `constant-lifecycle-apply`.
- Refuses to apply if the working tree has unstaged changes in `bunfig.toml` unless `--allow-dirty-bunfig` is passed.

`kimi-config rollback <proposal-id|decision-id|archive-name> --yes [--json]`

- Restores either the prior captured values from the proposal, a linked golden archive, or a lifecycle decision.
- Logs metadata type `constant-lifecycle-rollback`.
- Uses the existing golden archive machinery when restoring the whole golden baseline.

`kimi-config watch --auto-rollback --proposal <id> [--threshold 15] [--dry-run|--yes] [--json]`

- Reads Phase 4 health snapshots before and after a proposal.
- If health score drops by more than threshold, emits a rollback recommendation.
- With `--yes`, performs rollback and logs the decision.
- With `--dry-run`, reports the rollback command only.

## Data Model

Append lifecycle records to `.kimi/var/config-lifecycle.ndjson`.

```ts
interface ConfigLifecycleRecord {
  schemaVersion: 1;
  id: string;
  timestamp: string;
  type: "canary" | "ab" | "apply" | "rollback" | "watch";
  constant: string;
  values: Record<string, string | number | boolean>;
  status: "proposed" | "passed" | "failed" | "applied" | "rolled-back";
  validationIssues: ConstantValidationIssue[];
  suite?: string;
  decisionId?: string;
  healthBefore?: { timestamp: string; score: number };
  healthAfter?: { timestamp: string; score: number };
  message?: string;
}
```

IDs should be deterministic enough for dedupe:

```ts
const id = `cfg-${sha256String(JSON.stringify({ type, constant, values, suite })).slice(0, 16)}`;
```

## Implementation Slices

### Slice 1: Read-only lifecycle surface

- Add `src/lib/config-lifecycle.ts`.
- Add `configLifecyclePath(projectRoot)` to `src/lib/paths.ts`.
- Add `src/bin/kimi-config.ts` and register it in `package.json`.
- Implement `diff`, `validate`, and `timeline`.
- Tests: pure unit tests plus CLI JSON smoke.

### Slice 2: Proposal simulation

- Implement `canary` and `ab` as proposal-only commands.
- Use `TestConstants` for overrides.
- Add a minimal suite contract:
  - `default`: schema + cross-constant validation
  - `doctor`: runs `kimi-doctor --quick --json` only if explicitly requested
- Persist proposal records and link them to decisions only when apply/rollback happens.

### Slice 3: Apply and rollback

- Implement targeted `[define]` rewrite with structured parsing patterns from `constants-heal.ts`.
- Require `--yes` for mutation.
- Log decisions for apply and rollback.
- Reuse golden archive and repair helpers where possible.

### Slice 4: Watch with Phase 4 health snapshots

- Read `.kimi/var/health.ndjson`.
- Compare nearest before/after snapshots for a proposal.
- Emit rollback recommendations on threshold breach.
- Auto-rollback remains opt-in with `--yes`.

## Safety Rules

- No live Cloudflare mutation in Phase 5.
- No traffic routing claims for `[define]` constants.
- No `bunfig.toml` mutation without `--yes`.
- No mutation if proposed values fail schema or cross-constant validation.
- Decision ledger entries are required for apply and rollback.
- Analytical and proposal commands are read-only except for appending lifecycle proposal records.
- Preserve dirty user worktrees; never revert unrelated files.

## Test Plan

Unit tests:

- parse and validate proposed values by schema type
- reject invalid enum/range/integer values
- detect cross-constant violations
- produce diff output from golden/current values
- timeline finds repair, accept-drift, apply, and rollback records
- canary proposal writes lifecycle NDJSON without mutating `bunfig.toml`
- A/B proposal compares variants deterministically
- apply rewrites only targeted defines
- rollback restores prior values and logs a decision
- watch recommends rollback when health score drops over threshold

Smoke tests:

- `kimi-config diff --from golden --to current --impact --json`
- `kimi-config validate --json`
- `kimi-config timeline --constant KIMI_HOOK_VERIFIER_MAX_CYCLES --json`
- `kimi-config canary --constant KIMI_HOOK_VERIFIER_MAX_CYCLES --value 64 --percent 10 --json`
- `kimi-config ab --constant KIMI_HOOK_VERIFIER_MAX_CYCLES --a 32 --b 64 --duration 1h --json`

Validation before PR:

```sh
bun test test/config-lifecycle.unit.test.ts
bun test test/smoke/kimi-config.smoke.test.ts
bun run typecheck
bun run check:fast
bun run check
bun run sync && bun run sync:verify
```

## Open Dependency Notes

- Phase 3.1.x operator polish should land first so `constant-drift-accept`, repair dedupe, and impact preview are available on `main`.
- Phase 4 predictive doctor should land before Slice 4, because `watch --auto-rollback` depends on `.kimi/var/health.ndjson`.
- If either dependency is delayed, Slice 1 can still ship independently as read-only `diff`, `validate`, and `timeline`.
