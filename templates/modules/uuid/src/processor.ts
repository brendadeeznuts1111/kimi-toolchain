// templates/modules/uuid/src/processor.ts
// UUID v7 generator — registered via registerEffect("uuid") in init.ts

/** Generate a time-sortable UUID v7 string. */
export function generate(): string {
  return Bun.randomUUIDv7();
}
