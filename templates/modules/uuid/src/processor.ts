// templates/modules/uuid/src/processor.ts
// UUID v7 generator — registered under Symbol.for("kimi.effect.uuid")

/** Generate a time-sortable UUID v7 string. */
export function generate(): string {
  return Bun.randomUUIDv7();
}
