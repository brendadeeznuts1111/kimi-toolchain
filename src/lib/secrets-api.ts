/**
 * secrets-api.ts — Dashboard-safe secrets storage payload (no secret values).
 */

import { Effect } from "effect";
import { SecretsManager } from "./secrets-manager.ts";
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

export function buildSecretsApiResponseProgram(
  projectRoot: string
): Effect.Effect<SecretsApiResponse> {
  return Effect.gen(function* () {
    const manager = new SecretsManager({
      projectRoot,
      policyPath: secretsPolicyPath(projectRoot),
      onWarn: () => {},
    });

    const [storage, listed] = yield* Effect.all(
      [
        Effect.tryPromise({
          try: () => manager.storageStatus(),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }),
        manager.list(),
      ],
      { concurrency: "unbounded" }
    );

    return {
      available: isBunSecretsAvailable(),
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
  });
}

export { isStrictStorageEnabled } from "./secrets-storage.ts";