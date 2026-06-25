/**
 * effect/secrets-service.ts — Live/Test Layer factories for SecretsManager.
 *
 * Context.Tag and SecretsService interface live in secrets-manager.ts (co-located
 * with the implementation). This module wires Layers for Effect pipelines.
 */

import { Effect, Layer } from "effect";
import {
  Secrets,
  SecretsManager,
  type SecretsManagerOptions,
  type SecretsService,
} from "../secrets-manager.ts";
import type { StorageStatus } from "../secrets-storage.ts";
import type { SecretsBackend, StorageBackend } from "../secrets-types.ts";

export { Secrets, type SecretsService } from "../secrets-manager.ts";

function managerToService(manager: SecretsManager): SecretsService {
  return {
    get: (key, consumer) => manager.get(key, consumer),
    set: (key, value) => manager.set(key, value),
    delete: (key) => manager.delete(key),
    rotate: (key, newValue) => manager.rotate(key, newValue),
    list: () => manager.list(),
    check: () => manager.check(),
    audit: (query) => manager.audit(query),
    storageBackend: (): Effect.Effect<StorageBackend> =>
      Effect.tryPromise({
        try: () => manager.storageBackend(),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(Effect.orDie),
    storageStatus: (): Effect.Effect<StorageStatus> =>
      Effect.tryPromise({
        try: () => manager.storageStatus(),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(Effect.orDie),
  };
}

export function SecretsLive(opts?: SecretsManagerOptions): Layer.Layer<Secrets> {
  return Layer.succeed(Secrets, managerToService(new SecretsManager(opts)));
}

export function SecretsTest(
  backend: SecretsBackend,
  opts?: Omit<SecretsManagerOptions, "secrets">
): Layer.Layer<Secrets> {
  return Layer.succeed(
    Secrets,
    managerToService(new SecretsManager({ ...opts, secrets: backend }))
  );
}
