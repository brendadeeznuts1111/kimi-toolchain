/**
 * Compile-time constants injected by Bun from `bunfig.toml` `[define]`.
 *
 * SSOT: edit values in bunfig only — do not duplicate literals in source.
 * Regression: `bun run scripts/lint-build-constants.ts` (wired into `lint`).
 *
 * @see bunfig.toml `[define]`
 * @see scripts/lint-build-constants.ts
 * @see test/build-constants.unit.test.ts
 * @see CODE_REFERENCES.md § Build-time constants
 */

/** @tag contract-inference Relative path (under project root) for observation NDJSON. @see src/lib/paths.ts `contractObservationsPath` */
declare const KIMI_OBSERVATIONS_PATH: string;

/** @tag contract-inference Schema version written/read by contract inference. @see src/lib/contract-inference.ts */
declare const KIMI_CONTRACT_SCHEMA_VERSION: string;

/** @tag contract-inference When false, `inferContractFromObservations` skips work. */
declare const ENABLE_CONTRACT_INFERENCE: boolean;

/** @tag hook-verifier Max allowed hook-graph cycle length. @see src/lib/hook-verifier.ts */
declare const HOOK_VERIFIER_MAX_CYCLES: number;

/** @tag self-healing Reserved — embedding vector width (Phase 2: error-embedding.ts). */
declare const EMBEDDING_DIM: number;

/** @tag self-healing Reserved — decision score rolling window in days (Phase 2: decision-scoring.ts). */
declare const DECISION_SCORE_WINDOW_DAYS: number;

/** @tag self-healing Reserved — cluster merge threshold (Phase 2: error-clustering.ts). */
declare const CLUSTER_SIMILARITY_THRESHOLD: number;
