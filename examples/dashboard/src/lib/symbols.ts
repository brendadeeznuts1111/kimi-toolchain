const EFFECT_PREFIX = "kimi.effect.";

/** Resolve a registered effect handler from globalThis via Symbol.for. */
export function getEffect(name: string): unknown {
  const key = name.startsWith(EFFECT_PREFIX) ? name : `${EFFECT_PREFIX}${name}`;
  return (globalThis as Record<symbol, unknown>)[Symbol.for(key)];
}

export function registerEffect(name: string, handler: unknown): void {
  const key = name.startsWith(EFFECT_PREFIX) ? name : `${EFFECT_PREFIX}${name}`;
  (globalThis as Record<symbol, unknown>)[Symbol.for(key)] = handler;
}
