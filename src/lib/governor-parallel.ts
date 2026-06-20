/**
 * Parallelism Governor: semaphore-based concurrency limiter (Effect-TS).
 *
 * Uses Effect primitives (`Deferred`, `Effect.acquireRelease`) instead of
 * bare Promises to satisfy the Effect-discipline gate.
 *
 * @effect-gates-exempt-service-tag — utility class, not a Tag/Layer service.
 */

import { Effect, Deferred } from "effect";
import { DEFAULTS } from "./governor-state.ts";

export class ParallelGovernor {
  private semaphore: number;
  private queue: Array<Deferred.Deferred<void, never>>;

  constructor(maxConcurrent = DEFAULTS.maxParallelJobs) {
    this.semaphore = maxConcurrent;
    this.queue = [];
  }

  run<T>(fn: () => Promise<T>): Effect.Effect<T, never> {
    return Effect.acquireUseRelease(
      this.acquire(),
      () => Effect.promise(() => fn()),
      () => this.release()
    );
  }

  private acquire(): Effect.Effect<void, never> {
    return Effect.gen(this, function* () {
      if (this.semaphore > 0) {
        this.semaphore--;
        return;
      }
      const deferred = yield* Deferred.make<void, never>();
      this.queue.push(deferred);
      yield* Deferred.await(deferred);
    });
  }

  private release(): Effect.Effect<void, never> {
    return Effect.gen(this, function* () {
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) {
          yield* Deferred.succeed(next, undefined);
        }
      } else {
        this.semaphore++;
      }
    });
  }

  get available(): number {
    return this.semaphore;
  }

  get queued(): number {
    return this.queue.length;
  }
}
