/**
 * workflow/run-all-effect.ts — CLI-boundary Effect program for WorkflowLoop.runAll.
 */

import { Effect } from "effect";
import { startDelayedIntervalLoop } from "../bun-utils.ts";
import type { WorkflowLoop } from "./loop.ts";

export function workflowRunAllEffect(loop: WorkflowLoop): Effect.Effect<number> {
  return Effect.gen(function* () {
    const summary = yield* Effect.promise(() => loop.runOnce());
    if (summary.failed) return 1;
    if (!loop.options.watch) return 0;

    const intervalMs = loop.options.intervalMs ?? 60_000;
    return yield* Effect.async<number>((resume) => {
      loop.startWatchLoop(intervalMs, async () => {
        const next = await loop.runOnce();
        if (next.failed) {
          loop.stop();
          resume(Effect.succeed(1));
        }
      });
    });
  });
}