/**
 * effect/errors.ts — Tagged errors for kimi-toolchain Effect pipelines.
 */

import { Data } from "effect";

export class ToolNotFound extends Data.TaggedError("ToolNotFound")<{
  tool: string;
  path: string;
}> {}

export class ToolTimeout extends Data.TaggedError("ToolTimeout")<{
  tool: string;
  timeoutMs: number;
  gracePeriodMs: number;
}> {}

export class ExitNonZero extends Data.TaggedError("ExitNonZero")<{
  tool: string;
  exitCode: number;
  stderr: string;
}> {}

export class TaxonomyLoadFailed extends Data.TaggedError("TaxonomyLoadFailed")<{
  path: string;
  cause: string;
}> {}

export class CliError extends Data.TaggedError("CliError")<{
  message: string;
  exitCode?: number;
}> {}

export class EffectCliContractError extends Data.TaggedError("EffectCliContractError")<{
  message: string;
  toolName: string;
  taxonomyId: string;
  unknownFlag?: string;
  suggestions?: string[];
}> {}

export type ToolRunnerError = ToolNotFound | ToolTimeout | ExitNonZero;

export class ConfigNotFound extends Data.TaggedError("ConfigNotFound")<{
  kind: string;
  path: string;
}> {}

export class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
  path: string;
  cause: string;
}> {}

export class ConfigMergeConflict extends Data.TaggedError("ConfigMergeConflict")<{
  path: string;
}> {}

export type DxConfigError = ConfigNotFound | ConfigParseError | ConfigMergeConflict;

export class SecretNotFound extends Data.TaggedError("SecretNotFound")<{
  service: string;
  name: string;
}> {}

export class SecretPolicyViolation extends Data.TaggedError("SecretPolicyViolation")<{
  service: string;
  name: string;
  consumer: string;
  reason:
    | "consumer_not_allowed"
    | "secret_not_registered"
    | "secret_expired"
    | "storage_tier_mismatch";
}> {}

export class SecretRotationRequired extends Data.TaggedError("SecretRotationRequired")<{
  service: string;
  name: string;
  lastRotated: string | null;
  rotationDays: number;
  daysStale: number | null;
}> {}

export type SecretsError = SecretNotFound | SecretPolicyViolation | SecretRotationRequired;

// ── Identity Errors ──────────────────────────────────────────────────

export class JwtExpired extends Data.TaggedError("JwtExpired")<{
  token: string;
  exp: number;
}> {}

export class JwtInvalidSignature extends Data.TaggedError("JwtInvalidSignature")<{
  token: string;
}> {}

export class JwtInvalidFormat extends Data.TaggedError("JwtInvalidFormat")<{
  token: string;
  reason: string;
}> {}

export class JwtNotYetValid extends Data.TaggedError("JwtNotYetValid")<{
  token: string;
  nbf: number;
}> {}

export class JwtMissingSecret extends Data.TaggedError("JwtMissingSecret")<{
  service: string;
}> {}

export class SessionNotFound extends Data.TaggedError("SessionNotFound")<{
  sessionId: string;
}> {}

export class SessionExpired extends Data.TaggedError("SessionExpired")<{
  sessionId: string;
}> {}

export class SessionRevoked extends Data.TaggedError("SessionRevoked")<{
  sessionId: string;
}> {}

export class SessionLimitExceeded extends Data.TaggedError("SessionLimitExceeded")<{
  userId: string;
  max: number;
}> {}

export class CsrfTokenInvalid extends Data.TaggedError("CsrfTokenInvalid")<{
  token: string;
}> {}

export class CsrfTokenExpired extends Data.TaggedError("CsrfTokenExpired")<{
  token: string;
}> {}

export class CsrfTokenMismatch extends Data.TaggedError("CsrfTokenMismatch")<{
  token: string;
  expectedSessionId: string;
}> {}

export type JwtError =
  | JwtExpired
  | JwtInvalidSignature
  | JwtInvalidFormat
  | JwtNotYetValid
  | JwtMissingSecret;

export type SessionError = SessionNotFound | SessionExpired | SessionRevoked | SessionLimitExceeded;

export type CsrfError = CsrfTokenInvalid | CsrfTokenExpired | CsrfTokenMismatch;

export type IdentityError = JwtError | SessionError | CsrfError;
