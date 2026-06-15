/**
 * Contract inference from local observation NDJSON.
 *
 * @defineDomain contract-inference
 * @see types/build-constants.d.ts — `KIMI_CONTRACT_SCHEMA_VERSION`, `KIMI_CONTRACT_INFERENCE_ENABLED`
 * @see bunfig.toml `[define]` define-domain:contract-inference
 */

import { contractObservationsPath } from "./paths.ts";

export interface ContractInferenceResult {
  skipped?: boolean;
  reason?: string;
  schemaVersion?: string;
  observationsPath?: string;
}

export function inferContractFromObservations(projectRoot: string): ContractInferenceResult {
  if (!KIMI_CONTRACT_INFERENCE_ENABLED) {
    return { skipped: true, reason: "inference-disabled" };
  }

  return {
    schemaVersion: KIMI_CONTRACT_SCHEMA_VERSION,
    observationsPath: contractObservationsPath(projectRoot),
  };
}
