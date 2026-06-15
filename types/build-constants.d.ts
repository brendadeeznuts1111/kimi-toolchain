/**
 * Compile-time constants injected by Bun from `bunfig.toml` `[define]`.
 *
 * Naming layers (do not conflate):
 * - **define constant** — `KIMI_{DOMAIN}_{QUALIFIER}` SCREAMING_SNAKE globals below
 * - **defineDomain** — kebab-case slice label in bunfig (`# define-domain:…`) and `@defineDomain` JSDoc
 * - **taxonomyId** — snake_case failure class in `error-taxonomy.yml` (runtime, not define)
 *
 * SSOT: edit values in bunfig only — do not duplicate literals in source.
 * Regression: `bun run scripts/lint-build-constants.ts` (wired into `lint`).
 *
 * @see bunfig.toml `[define]`
 * @see scripts/lint-build-constants.ts
 * @see test/build-constants.unit.test.ts
 * @see CODE_REFERENCES.md § Build-time constants
 */

/** @defineDomain contract-inference Relative path (under project root) for observation NDJSON. @see src/lib/paths.ts `contractObservationsPath` */
declare const KIMI_CONTRACT_OBSERVATIONS_PATH: string;

/** @defineDomain contract-inference Schema version written/read by contract inference. @see src/lib/contract-inference.ts */
declare const KIMI_CONTRACT_SCHEMA_VERSION: string;

/** @defineDomain contract-inference When false, `inferContractFromObservations` skips work. */
declare const KIMI_CONTRACT_INFERENCE_ENABLED: boolean;

/** @defineDomain hook-verifier Max allowed hook-graph cycle length. @see src/lib/hook-verifier.ts */
declare const KIMI_HOOK_VERIFIER_MAX_CYCLES: number;

/** @defineDomain error-embedding Reserved — embedding vector width (Phase 2: error-embedding.ts). */
declare const KIMI_ERROR_EMBEDDING_DIM: number;

/** @defineDomain decision-scoring Reserved — decision score rolling window in days (Phase 2: decision-scoring.ts). */
declare const KIMI_DECISION_SCORE_WINDOW_DAYS: number;

/** @defineDomain error-clustering Reserved — cluster merge threshold (Phase 2: error-clustering.ts). */
declare const KIMI_ERROR_CLUSTER_SIMILARITY_THRESHOLD: number;
