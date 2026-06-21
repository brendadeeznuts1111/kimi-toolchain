/**
 * Uniform effect registration helper for KIMI_MODULES.
 *
 * Each domain effect processor exports a namespace object and registers it under
 * `Symbol.for("kimi.effect.<name>")`. The perf harness discovers handlers by
 * scanning `Object.getOwnPropertySymbols(globalThis)` for this prefix.
 */

const EFFECT_PREFIX = "kimi.effect.";

/** Register a domain effect namespace under `Symbol.for("kimi.effect.<name>")`. */
export function registerEffect(name: string, handler: unknown): void {
  const key = name.startsWith(EFFECT_PREFIX) ? name : `${EFFECT_PREFIX}${name}`;
  (globalThis as Record<symbol, unknown>)[Symbol.for(key)] = handler;
}

/** Resolve a registered effect handler from globalThis. */
export function getEffect(name: string): unknown {
  const key = name.startsWith(EFFECT_PREFIX) ? name : `${EFFECT_PREFIX}${name}`;
  return (globalThis as Record<symbol, unknown>)[Symbol.for(key)];
}
