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
  taxonomyId?: string;
  suggestion?: string;
  autoFix?: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
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

export class ConfigNotFound extends Data.TaggedError("ConfigNotFound")<{
  path: string;
  kind: "global" | "project";
}> {}

export class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
  path: string;
  cause: string;
}> {}

export class ConfigMergeConflict extends Data.TaggedError("ConfigMergeConflict")<{
  path: string;
  globalValue: string;
  projectValue: string;
}> {}

export class EffectNotRegisteredError extends Data.TaggedError("EffectNotRegisteredError")<{
  symbol: string;
  label: string;
}> {}

export class ThresholdExceededError extends Data.TaggedError("ThresholdExceededError")<{
  operation: string;
  actualMs: number;
  thresholdMs: number;
}> {}

export class HealGoldenMissingError extends Data.TaggedError("HealGoldenMissingError")<{
  command: string;
}> {}

export class HealInvalidArgumentError extends Data.TaggedError("HealInvalidArgumentError")<{
  flag: string;
  message: string;
}> {}

export type DxConfigError = ConfigNotFound | ConfigParseError | ConfigMergeConflict;

export type ToolRunnerError = ToolNotFound | ToolTimeout | ExitNonZero;

export type HealError =
  | HealGoldenMissingError
  | HealInvalidArgumentError
  | EffectNotRegisteredError;
