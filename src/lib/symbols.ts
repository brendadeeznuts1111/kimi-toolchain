/**
 * symbols.ts — Effect pipeline symbol registry.
 *
 * Each Symbol in EFFECT_PIPELINE represents a stage in the Effect processing
 * pipeline. Handlers register on globalThis under these symbols so the audit
 * system can verify that every declared pipeline stage has a live handler.
 *
 * Add new pipeline stages here as the effect system evolves. The audit in
 * kimi-heal.ts checks that every symbol in this array has a registered handler.
 */

/** Pipeline stage identifiers — ordered by processing sequence. */
export const EFFECT_PIPELINE: readonly symbol[] = [
  // Core pipeline stages
  Symbol.for("kimi.effect.validate"),
  Symbol.for("kimi.effect.transform"),
  Symbol.for("kimi.effect.execute"),
  Symbol.for("kimi.effect.observe"),
  Symbol.for("kimi.effect.audit"),

  // Domain pipeline stages
  Symbol.for("kimi.effect.domain.image.process"),
  Symbol.for("kimi.effect.domain.image.benchmark"),
  Symbol.for("kimi.effect.domain.image.train"),
];

/** Pipeline stage display names for audit reporting. */
export const EFFECT_PIPELINE_NAMES: Readonly<Record<string, string>> = {
  "Symbol.for(kimi.effect.validate)": "validate",
  "Symbol.for(kimi.effect.transform)": "transform",
  "Symbol.for(kimi.effect.execute)": "execute",
  "Symbol.for(kimi.effect.observe)": "observe",
  "Symbol.for(kimi.effect.audit)": "audit",
  "Symbol.for(kimi.effect.domain.image.process)": "image.process",
  "Symbol.for(kimi.effect.domain.image.benchmark)": "image.benchmark",
  "Symbol.for(kimi.effect.domain.image.train)": "image.train",
};
