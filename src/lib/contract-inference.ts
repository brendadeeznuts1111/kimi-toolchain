/**
 * Contract inference from local observation NDJSON.
 *
 * @tag contract-inference
 * @see types/build-constants.d.ts — `KIMI_CONTRACT_SCHEMA_VERSION`, `ENABLE_CONTRACT_INFERENCE`
 * @see bunfig.toml `[define]` tag:contract-inference
 */

import { contractObservationsPath } from "./paths.ts";

export interface ContractInferenceResult {
  skipped?: boolean;
  reason?: string;
  schemaVersion?: string;
  observationsPath?: string;
}

export function inferContractFromObservations(projectRoot: string): ContractInferenceResult {
  if (!ENABLE_CONTRACT_INFERENCE) {
    return { skipped: true, reason: "inference-disabled" };
  }

  return {
    schemaVersion: KIMI_CONTRACT_SCHEMA_VERSION,
    observationsPath: contractObservationsPath(projectRoot),
  };
}
