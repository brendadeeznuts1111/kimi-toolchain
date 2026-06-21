// templates/modules/clock/src/processor.ts
// Monotonic high-resolution clock — registered via registerEffect("clock") in init.ts

/** Return monotonic time in nanoseconds (Bun.nanoseconds). */
export function now(): number {
  return Bun.nanoseconds();
}
