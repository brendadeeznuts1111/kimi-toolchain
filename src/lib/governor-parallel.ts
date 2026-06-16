/**
 * Parallelism Governor: semaphore-based concurrency limiter
 */

import { Deferred, Effect } from "effect";
import { DEFAULTS } from "./governor-state.ts";

/**
 * Semaphore-based concurrency governor. Not a Tag/Layer service — a plain
 * mutable utility used by the resource governor CLI.
 *
 * @effect-gates-exempt-service-tag
 */
export class ParallelGovernor {
  private semaphore: number;
  private queue: Array<Deferred.Deferred<void, never>> = [];

  constructor(maxConcurrent = DEFAULTS.maxParallelJobs) {
    this.semaphore = maxConcurrent;
  }

  run<T, E, R>(fn: () => Effect.Effect<T, E, R>): Effect.Effect<T, E, R> {
    return Effect.acquireUseRelease(this.acquire(), fn, () => this.release());
  }

  private acquire(): Effect.Effect<void, never> {
    return Effect.gen(
      function* (this: ParallelGovernor) {
        if (this.semaphore > 0) {
          this.semaphore--;
          return;
        }
        const deferred = yield* Deferred.make<void, never>();
        this.queue.push(deferred);
        yield* Deferred.await(deferred);
      }.bind(this)
    );
  }

  private release(): Effect.Effect<void, never> {
    return Effect.gen(
      function* (this: ParallelGovernor) {
        if (this.queue.length > 0) {
          const next = this.queue.shift()!;
          yield* Deferred.succeed(next, undefined);
        } else {
          this.semaphore++;
        }
      }.bind(this)
    );
  }

  get available() {
    return this.semaphore;
  }

  get queued() {
    return this.queue.length;
  }
}
