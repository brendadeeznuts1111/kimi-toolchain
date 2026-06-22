---
title: "Extend"
tags: [examples]
category: examples
status: draft
priority: medium
---
# Generic Gate Tree Example — Extending the Gate Tree

## Add a new gate

1. Create `src/gates/my-gate.ts`:

```ts
import type { Gate, GateResult } from "./types.ts";

export interface MyGateResult extends GateResult {
  status: "pass" | "warn" | "fail";
  metrics: { score: number };
}

export async function runMyGate(): Promise<MyGateResult> {
  const score = 0.9;
  return {
    status: score > 0.8 ? "pass" : "warn",
    metrics: { score },
    timestamp: new Date().toISOString(),
  };
}

export const myGateDefinition: Gate = {
  name: "my-gate",
  description: "My custom gate (L2)",
  level: 2,
  dependsOn: ["health-check"], // runs after health-check
  parallel: false,
  run: runMyGate,
};
```

2. Register in `src/gates/init.ts`:

```ts
import { myGateDefinition } from "./my-gate.ts";
registerGate(myGateDefinition);
```

3. Run it:

```bash
bun run src/bin/gate-doctor.ts --gate my-gate --save-artifact
```

## Gate levels

| Level | Cadence       | Purpose            | Example                              |
| ----- | ------------- | ------------------ | ------------------------------------ |
| L1    | Minutes/hours | Tactical health    | `health-check`, `data-freshness`     |
| L2    | Hours/days    | Strategic analysis | `strategy-check`, `model-drift`      |
| L3    | Days/weeks    | Governance audit   | `license-check`, `guardian-baseline` |

## Retention

Each gate can declare a `retentionPolicy`:

```ts
retentionPolicy: {
  maxAgeMs: 24 * 60 * 60 * 1000, // 1 day
  maxCount: 100,
}
```

Defaults are level-aware: L1=7 days, L2=30 days, L3=180 days.

## Parallel gates

Set `parallel: true` to run gates concurrently at the same dependency depth:

```ts
export const myGate: Gate = {
  name: "my-gate",
  level: 1,
  dependsOn: [],
  parallel: true, // runs in parallel with other L1 gates
  run: runMyGate,
};
```

## Lineage

The runner automatically tracks `dependsOn` lineage. When a gate runs, its artifact includes the upstream artifact paths consumed. This is used by `kimi-doctor --artifacts-lineage`.

## Herdr integration

To surface gate results in the Herdr dashboard:

```ts
import { saveArtifact } from "./lib/artifact-store.ts";

await saveArtifact("var/artifacts", "health-check", {
  schemaVersion: 1,
  gate: "health-check",
  savedAt: new Date().toISOString(),
  metadata: { level: 1, hostname: "...", pid: 123, bunVersion: "1.3" },
  payload: { status: "pass" },
});
```

## Related

- [examples/trading-workspace/](../../../examples/trading-workspace/) — Full trading loop with artifact store
- [examples/artifact-trading-loop.md](../../../examples/artifact-trading-loop.md) — L1→L2 narrative
- [examples/artifact-dependency-graphs.md](../../../examples/artifact-dependency-graphs.md) — lineage vs execution DAG
