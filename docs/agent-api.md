# Agent API

Effect-native agents can call the introspection surface directly instead of
spawning CLI commands. The CLI remains the stable human/script interface; these
services are for code already running inside an Effect program.

## Kimi Toolchain Services

Import from the public Effect barrel:

```ts
import {
  KimiCapabilities,
  KimiContract,
  KimiIntrospectionLive,
  KimiIntrospectionLiveFor,
  KimiTrace,
  DecisionLogger,
  DecisionLoggerLive,
} from "../src/lib/effect/index.ts";
```

`KimiIntrospectionLive` resolves the current git root. Tests and embedded agents
can use `KimiIntrospectionLiveFor({ projectRoot })` to pin a project explicitly.

## Capabilities

`KimiCapabilities` exposes live readiness probes without shelling out:

```ts
import { Effect } from "effect";
import { KimiCapabilities, KimiIntrospectionLive } from "../src/lib/effect/index.ts";

const checkSystemHealth = Effect.gen(function* () {
  const capabilities = yield* KimiCapabilities;
  const health = yield* capabilities.probe();
  if (health.readiness < 80) {
    yield* Effect.logWarning("System readiness below 80%");
  }
  return health;
}).pipe(Effect.provide(KimiIntrospectionLive));
```

The returned value includes `readiness`, canonical `readinessScore`, normalized
`items`, and the raw `CapabilityReport`.

## Trace

`KimiTrace` reconstructs a causal trace tree by id. Unknown ids fail with the
typed `TraceNotFound` error.

```ts
import { Effect } from "effect";
import { KimiIntrospectionLive, KimiTrace, TraceNotFound } from "../src/lib/effect/index.ts";

const explainFailure = (traceId: string) =>
  Effect.gen(function* () {
    const traces = yield* KimiTrace;
    return yield* traces.trace(traceId);
  }).pipe(
    Effect.catchTag("TraceNotFound", (error: TraceNotFound) =>
      Effect.succeed({ rootTraceId: error.traceId, steps: [], rootCauseChain: [] })
    ),
    Effect.provide(KimiIntrospectionLive)
  );
```

The service result includes `rootTraceId`, `requestedTraceId`, normalized
`steps`, `rootCauseChain`, and the raw `TraceGraph`.

## Contracts

`KimiContract` validates and signs contracts through the same normalization and
Ed25519 code used by `kimi-contract`.

```ts
import { Effect } from "effect";
import { KimiContract, KimiIntrospectionLive } from "../src/lib/effect/index.ts";

const validateContract = (contractPath: string) =>
  Effect.gen(function* () {
    const contracts = yield* KimiContract;
    const validation = yield* contracts.validate(contractPath);
    return {
      status: validation.status,
      trusted: validation.trusted,
      recognizedSigner: validation.recognizedSigner,
    };
  }).pipe(Effect.provide(KimiIntrospectionLive));
```

`contracts.sign(path, keyId)` reads `KIMI_SIGNING_KEY` or
`KIMI_SIGNING_KEY_FILE`. Missing key material fails with `MissingSigningKey`.
Validation failures are represented as `ContractValidationError`; signing uses
the underlying typed `ContractError` values from `src/lib/contract-signing.ts`.

## Decisions

`DecisionLogger` records and queries durable rationale in
`~/.kimi-code/var/decision-ledger.jsonl`. Use it when an Effect program changes
toolchain state and needs to explain why later.

```ts
import { Effect } from "effect";
import { DecisionLogger, DecisionLoggerLive } from "../src/lib/effect/index.ts";

const recordHookDecision = Effect.gen(function* () {
  const decisions = yield* DecisionLogger;
  return yield* decisions.recordAction({
    key: "hook-register:pre-push",
    actor: "kimi",
    action: "hook-register",
    trigger: "trace-hook-registration",
    rationale: "Managed hooks keep sync manifests fresh before push.",
    outcome: "success",
  });
}).pipe(Effect.provide(DecisionLoggerLive()));
```

The service exposes `logDecision`, `recordAction`, `list`, and `why`.
`why(query)` returns matching decisions, follow-up decisions, and a linked
`TraceGraph` root-cause chain when the decision trigger or trace id is present.

## CLI Bridge

Use the CLI for shell scripts and ad-hoc operator checks:

```bash
bun run capabilities --json
bun run kimi contract validate ./contracts/sample.contract.json --json
bun run kimi decision log --json
bun run kimi why <decision-id> --json
```

Use the services when an Effect program needs to compose probes, traces,
contract validation, and decision rationale without subprocess overhead or
stringly typed JSON parsing.
