import { Effect } from "effect";

/** Reactive smoke test marker — safe to delete after production validation. */
export const reactiveSmokeMarker = "2026-06-16T19:52:39Z";
export const reactiveSmokeStep = "3a-context-sync";

// intentional effect-gate violation for Step 3b smoke test
void Effect.runPromise(Effect.succeed("break"));
