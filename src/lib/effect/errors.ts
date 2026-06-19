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

export type ToolRunnerError = ToolNotFound | ToolTimeout | ExitNonZero;
