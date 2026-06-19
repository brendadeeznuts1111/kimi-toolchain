/**
 * Tagged errors for DX config resolution.
 */

import { Data } from "effect";

export class ConfigReadError extends Data.TaggedError("ConfigReadError")<{
  readonly path: string;
  readonly reason: "not_found" | "parse_failed" | "invalid_format";
}> {}

export class ConfigMergeError extends Data.TaggedError("ConfigMergeError")<{
  readonly message: string;
}> {}

export type ConfigError = ConfigReadError | ConfigMergeError;
