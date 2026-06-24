/**
 * secrets-api.ts — Dashboard-safe secrets storage payload (no secret values).
 */

import { SecretsManager } from "./secrets-manager.ts";
import { runSecretsList } from "./effect/secrets-runtime.ts";
import {
  bunSecretsMethods,
  effectiveStorageTier,
  isBunSecretsAvailable,
  isStrictStorageEnabled,
} from "./secrets-storage.ts";
import { secretsPolicyPath } from "./paths.ts";
import type { StorageStatus } from "./secrets-storage.ts";

export interface SecretsApiSecretRow {
  service: string;
  name: string;
  present: boolean;
  storageTier: string;
  resolvedVia?: string;
}

export interface SecretsApiResponse {
  available: boolean;
  methods: { get: boolean; set: boolean; delete: boolean };
  platform: NodeJS.Platform;
  storage: StorageStatus;
  strictStorage: boolean;
  secrets: SecretsApiSecretRow[];
  note: string;
}

export async function buildSecretsApiResponse(projectRoot: string): Promise<SecretsApiResponse> {
  const available = isBunSecretsAvailable();
  const manager = new SecretsManager({
    projectRoot,
    policyPath: secretsPolicyPath(projectRoot),
    onWarn: () => {},
  });

  const [storage, listed] = await Promise.all([manager.storageStatus(), runSecretsList(manager)]);

  return {
    available,
    methods: bunSecretsMethods(),
    platform: process.platform,
    storage,
    strictStorage: isStrictStorageEnabled(),
    secrets: listed.map((row) => ({
      service: row.key.service,
      name: row.key.name,
      present: row.present,
      storageTier: row.policy ? effectiveStorageTier(row.policy) : "unregistered",
      resolvedVia: row.resolvedVia,
    })),
    note:
      storage.securityLevel === "high"
        ? "Per-user OS credential store (no plaintext fallback)"
        : "Linux env-fallback — only storageTier: env-fallback secrets read from env",
  };
}

export { isStrictStorageEnabled } from "./secrets-storage.ts";
