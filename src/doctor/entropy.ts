/**
 * entropy.ts — Shannon entropy helper for doctor image-audit tests.
 *
 * Re-exports the optimized implementation from src/lib/image-audit.ts so the
 * doctor tests and any orchestrator pipeline can share the same calculation.
 */
export { shannonEntropy } from "../lib/image-audit.ts";
