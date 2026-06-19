// templates/modules/clock/src/processor.ts
// Monotonic high-resolution clock — registered under Symbol.for("kimi.effect.clock")

/** Return monotonic time in nanoseconds (Bun.nanoseconds). */
export function now(): number {
  return Bun.nanoseconds();
}
