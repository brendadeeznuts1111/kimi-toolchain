/**
 * Compile-time feature flags for bundled toolchain binaries.
 * At `bun run` time flags are false unless you bundle with `--feature=FLAG`.
 *
 *   bun build --compile --feature=DEBUG --feature=ONLINE scripts/inspect-references.ts
 */
import { feature } from "bun:bundle";

/** Verbose reference inspect/generate logging — eliminated from release bundles. */
export const isDebugBuild = feature("DEBUG");

/** Network-backed reference lint (future) — eliminated from offline bundles. */
export const isOnlineBuild = feature("ONLINE");

/** Mock external APIs in test/agent bundles. */
export const isMockApiBuild = feature("MOCK_API");

/** Premium-only reference lint paths. */
export const isPremiumBuild = feature("PREMIUM");
