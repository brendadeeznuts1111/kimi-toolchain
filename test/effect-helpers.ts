/**
 * Effect test utilities — layer composition without ceremony.
 *
 * Import from Effect test files; not preloaded globally.
 */

import { Effect, type Layer } from "effect";

/** Run an Effect program with a provided layer (canonical test entry). */
export function runWithLayer<A, E, R>(
  program: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Promise<A> {
  return Effect.runPromise(program.pipe(Effect.provide(layer)));
}
