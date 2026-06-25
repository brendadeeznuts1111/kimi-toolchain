/**
 * secrets-gate.ts — CI gate for Linux env-fallback storage tier alignment.
 */

import { SecretsManager } from "./secrets-manager.ts";
import { secretsPolicyPath } from "./paths.ts";
import type { StorageBackend } from "./secrets-types.ts";

export const SECRETS_STORAGE_TIER_MISMATCH_TAXONOMY = "secrets_storage_tier_mismatch";

export interface SecretsStorageGateResult {
  ok: boolean;
  message: string;
  taxonomyId?: string;
  backend?: string;
  insecureSecretCount?: number;
  skipped?: boolean;
}

export interface SecretsStorageGateOptions {
  detectBackend?: () => Promise<StorageBackend>;
}

export async function runSecretsStorageGate(
  projectRoot: string,
  opts: SecretsStorageGateOptions = {}
): Promise<SecretsStorageGateResult> {
  const policyPath = secretsPolicyPath(projectRoot);
  if (!(await Bun.file(policyPath).exists())) {
    return {
      ok: true,
      skipped: true,
      message: "secrets-policy.json5 missing — gate skipped",
    };
  }

  const manager = new SecretsManager({
    projectRoot,
    policyPath,
    detectBackend: opts.detectBackend,
    onWarn: () => {},
  });
  const status = await manager.storageStatus();

  if (status.backend !== "env-fallback") {
    return {
      ok: true,
      message: `${status.backend} backend (${status.securityLevel} security)`,
      backend: status.backend,
      insecureSecretCount: 0,
    };
  }

  if (status.insecureSecretCount === 0) {
    return {
      ok: true,
      message: `env-fallback with ${status.envFallbackOptInCount} opt-in secret(s)`,
      backend: status.backend,
      insecureSecretCount: 0,
    };
  }

  return {
    ok: false,
    message: `${status.insecureSecretCount} secret(s) lack storageTier: "env-fallback" on Linux env-fallback backend`,
    taxonomyId: SECRETS_STORAGE_TIER_MISMATCH_TAXONOMY,
    backend: status.backend,
    insecureSecretCount: status.insecureSecretCount,
  };
}
