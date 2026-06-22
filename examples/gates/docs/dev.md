---
title: "Dev"
tags: [examples]
category: examples
status: draft
priority: medium
---
# Development Guide — Generic Gate Tree

This guide covers the local development loop for the gate tree example. It is
also representative of how to develop any `kimi-gates` scaffolded project.

## Quickstart

```bash
cd examples/gates
bun install
bun test              # starter tests — should pass out of the box
bun run gate:plan     # preview execution order
bun run gate:all      # run all gates and save artifacts
```

## Watch mode

Bun's built-in `--watch` flag restarts the process when source changes:

```bash
# Run all gates on every source change
bun run dev

# Equivalent manual form
bun run --watch src/bin/gate-doctor.ts --all --save-artifact

# Watch tests
bun test --watch
```

## Inspecting gate runs

### Dry-run before running

Always preview the plan first:

```bash
bun run gate:plan
# or
bun run src/bin/gate-doctor.ts --all --dry-run
```

Expected order (dependency-first):

```
data-freshness (L1) [parallel]
health-check (L1) [parallel]
strategy-check (L2) ← data-freshness, health-check
```

### Inspect a saved artifact

```bash
bun run gate:all
ls var/artifacts/health-check
kimi-doctor --artifacts-latest health-check
```

Artifacts are JSON envelopes with `payload`, `metadata`, and `savedAt`.

## Debugging with `--inspect`

Attach a debugger to the gate runner:

```bash
bun --inspect src/bin/gate-doctor.ts --all --save-artifact
```

Then open the printed WebSocket URL in Chrome DevTools or an IDE that supports
Bun's inspector protocol.

## Adding a new gate

1. Create `src/gates/my-gate.ts`:

   ```ts
   import type { Gate, GateResult } from "./types.ts";

   export const myGateDefinition: Gate = {
     name: "my-gate",
     description: "My custom gate",
     level: 2,
     dependsOn: ["health-check"],
     run: async () => ({ status: "pass" }),
   };
   ```

2. Register it in `src/gates/init.ts`:

   ```ts
   import { myGateDefinition } from "./my-gate.ts";
   registerGate(myGateDefinition);
   ```

3. Add a test in `test/gates.unit.test.ts`.

4. Run `bun test` and `bun run gate:plan`.

## Environment variables

See `.env.example`. The most useful variable is `KIMI_ARTIFACTS_DIR`:

```bash
KIMI_ARTIFACTS_DIR=/tmp/gate-artifacts bun run gate:all
```

## Cleaning artifacts

Artifacts are gitignored (`var/artifacts/`). Clean safely:

```bash
rm -rf var/artifacts
```

In tests, always use a temporary directory and clean it in `finally` or with a
helper like `cleanupPath()`.

## Related

- `README.md` — overview and commands
- `docs/extend.md` — gate levels, retention, lineage
- `templates/bun-create/kimi-gates/` — the starter template this example mirrors
