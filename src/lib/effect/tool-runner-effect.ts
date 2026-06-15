/**
 * effect/tool-runner-effect.ts — Effect-based tool invocation with typed errors.
 */

import { Effect } from "effect";
import { existsSync } from "fs";
import { join } from "path";
import {
  invokeTool,
  toolsDir,
  type ToolInvocation,
  type ToolInvocationOptions,
} from "../tool-runner.ts";
import { ToolNotFound, ToolTimeout, ExitNonZero, type ToolRunnerError } from "./errors.ts";

export type ToolInvocationWithTaxonomy = ToolInvocation;

const DEFAULT_GRACE_PERIOD_MS = 5000;

function mapInvocationResult(
  result: ToolInvocation,
  gracePeriodMs: number
): Effect.Effect<ToolInvocationWithTaxonomy, ToolTimeout | ExitNonZero> {
  if (result.timedOut) {
    return Effect.fail(
      new ToolTimeout({
        tool: result.tool,
        timeoutMs: result.timeoutMs,
        gracePeriodMs,
      })
    );
  }
  if (result.exitCode !== 0) {
    return Effect.fail(
      new ExitNonZero({
        tool: result.tool,
        exitCode: result.exitCode,
        stderr: result.stderr || result.error || "",
        ...(result.taxonomyId ? { taxonomyId: result.taxonomyId } : {}),
        ...(result.suggestion ? { suggestion: result.suggestion } : {}),
        ...(result.autoFix ? { autoFix: result.autoFix } : {}),
        ...(result.stdoutTruncated ? { stdoutTruncated: result.stdoutTruncated } : {}),
        ...(result.stderrTruncated ? { stderrTruncated: result.stderrTruncated } : {}),
      })
    );
  }
  if (result.error) {
    return Effect.fail(
      new ExitNonZero({
        tool: result.tool,
        exitCode: result.exitCode,
        stderr: result.error,
        ...(result.taxonomyId ? { taxonomyId: result.taxonomyId } : {}),
        ...(result.suggestion ? { suggestion: result.suggestion } : {}),
        ...(result.autoFix ? { autoFix: result.autoFix } : {}),
        ...(result.stdoutTruncated ? { stdoutTruncated: result.stdoutTruncated } : {}),
        ...(result.stderrTruncated ? { stderrTruncated: result.stderrTruncated } : {}),
      })
    );
  }
  return Effect.succeed(result);
}

/** Invoke a tool by path; taxonomy enrichment happens in invokeTool(). */
export function invokeToolEffect(
  toolPath: string,
  args: string[],
  options: ToolInvocationOptions = {}
): Effect.Effect<ToolInvocationWithTaxonomy, ToolRunnerError> {
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  return Effect.tryPromise({
    try: () => invokeTool(toolPath, args, options),
    catch: () => new ToolNotFound({ tool: toolPath, path: toolPath }),
  }).pipe(Effect.flatMap((result) => mapInvocationResult(result, gracePeriodMs)));
}

/** Run a toolchain tool by short name with typed not-found errors. */
export function runToolEffect(
  toolName: string,
  args: string[],
  options?: ToolInvocationOptions
): Effect.Effect<ToolInvocationWithTaxonomy, ToolRunnerError> {
  const toolPath = join(toolsDir(), `${toolName}.ts`);
  if (!existsSync(toolPath)) {
    return Effect.fail(new ToolNotFound({ tool: toolName, path: toolPath }));
  }
  return invokeToolEffect(toolPath, args, options);
}

/** Thin promise wrapper for legacy callers. */
export async function invokeToolWithTaxonomy(
  toolPath: string,
  args: string[],
  options: ToolInvocationOptions = {}
): Promise<ToolInvocationWithTaxonomy> {
  return Effect.runPromise(invokeToolEffect(toolPath, args, options));
}
