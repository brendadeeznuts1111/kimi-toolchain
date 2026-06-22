/**
 * Secrets runtime boundary — Effect.runPromise is allowed here.
 *
 * Keeps dashboard API and CLI command implementations free of direct
 * Effect.runPromise calls so the effect-gates checker stays happy.
 */

import { Effect, Either } from "effect";
import { SecretsManager } from "../secrets-manager.ts";
import type {
  AnySecretKey,
  SecretCheckResult,
  SecretListResult,
} from "../secrets-types.ts";
import type { SecretNotFound, SecretPolicyViolation, SecretRotationRequired } from "./errors.ts";

export function runSecretsList(manager: SecretsManager): Promise<SecretListResult[]> {
  return Effect.runPromise(manager.list());
}

export function runSecretsCheck(
  manager: SecretsManager
): Promise<Either.Either<SecretCheckResult[], SecretRotationRequired>> {
  return Effect.runPromise(Effect.either(manager.check()));
}

export function runSecretsRotate(
  manager: SecretsManager,
  key: AnySecretKey,
  newValue?: string
): Promise<Either.Either<{ version: number; lastRotated: string }, SecretNotFound | SecretPolicyViolation>> {
  return Effect.runPromise(Effect.either(manager.rotate(key, newValue)));
}
