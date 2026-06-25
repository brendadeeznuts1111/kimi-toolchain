/**
 * effect/secrets-service.ts — Effect Context.Tag + Live/Test layers
 * for SecretsManager dependency injection in Effect pipelines.
 *
 * Test layer for Effect pipelines; production uses SecretsTest via serve-identity.
 */

import { Context, Effect, Layer } from "effect";
import { SecretsManager, type SecretsManagerOptions } from "../secrets-manager.ts";
import { SecretNotFound, SecretPolicyViolation, SecretRotationRequired } from "./errors.ts";
import type { StorageStatus } from "../secrets-storage.ts";
import type {
  AnySecretKey,
  SecretAuditRecord,
  SecretCheckResult,
  SecretListResult,
  AuditQuery,
  SecretsBackend,
  StorageBackend,
} from "../secrets-constants.ts";

export interface SecretsService {
  readonly get: (
    key: AnySecretKey,
    consumer: string
  ) => Effect.Effect<string | null, SecretNotFound | SecretPolicyViolation>;
  readonly set: (key: AnySecretKey, value: string) => Effect.Effect<void, SecretPolicyViolation>;
  readonly delete: (key: AnySecretKey) => Effect.Effect<boolean>;
  readonly rotate: (
    key: AnySecretKey,
    newValue?: string
  ) => Effect.Effect<
    { version: number; lastRotated: string },
    SecretNotFound | SecretPolicyViolation
  >;
  readonly list: () => Effect.Effect<SecretListResult[]>;
  readonly check: () => Effect.Effect<SecretCheckResult[], SecretRotationRequired>;
  readonly audit: (query: AuditQuery) => Effect.Effect<SecretAuditRecord[]>;
  readonly storageBackend: () => Effect.Effect<StorageBackend>;
  readonly storageStatus: () => Effect.Effect<StorageStatus>;
}

export class Secrets extends Context.Tag("Secrets")<Secrets, SecretsService>() {}

export function SecretsTest(
  backend: SecretsBackend,
  opts?: Omit<SecretsManagerOptions, "secrets">
): Layer.Layer<Secrets> {
  const manager = new SecretsManager({ ...opts, secrets: backend });
  return Layer.succeed(Secrets, {
    get: (key, consumer) => manager.get(key, consumer),
    set: (key, value) => manager.set(key, value),
    delete: (key) => manager.delete(key),
    rotate: (key, newValue) => manager.rotate(key, newValue),
    list: () => manager.list(),
    check: () => manager.check(),
    audit: (query) => manager.audit(query),
    storageBackend: (): Effect.Effect<StorageBackend> =>
      Effect.tryPromise(() => manager.storageBackend()).pipe(Effect.orDie),
    storageStatus: (): Effect.Effect<StorageStatus> =>
      Effect.tryPromise(() => manager.storageStatus()).pipe(Effect.orDie),
  });
}
