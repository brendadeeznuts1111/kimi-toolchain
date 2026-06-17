/**
 * effect/tool-runner-effect.ts — Effect-based tool invocation with typed errors.
 */

import { pathExists } from "../bun-io.ts";

import { Effect } from "effect";
import { join } from "path";
import {
  invokeCommand,
  invokeTool,
  toolsDir,
  type CommandInvocationOptions,
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

/**
 * Invoke an arbitrary command through the Effect boundary.
 * Non-zero exit codes remain success so callers can parse stdout/stderr (plugins, MCP).
 */
export function invokeCommandEffect(
  command: string[],
  options: CommandInvocationOptions = {}
): Effect.Effect<ToolInvocationWithTaxonomy, ToolTimeout | ToolNotFound | ExitNonZero> {
  if (command.length === 0) {
    return Effect.fail(new ToolNotFound({ tool: "(empty)", path: "" }));
  }
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  const tool = options.tool ?? command[0] ?? "";
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => invokeCommand(command, options),
      catch: (e) =>
        new ExitNonZero({
          tool,
          exitCode: -1,
          stderr: e instanceof Error ? e.message : String(e),
        }),
    });
    if (result.timedOut) {
      return yield* Effect.fail(
        new ToolTimeout({
          tool: result.tool,
          timeoutMs: result.timeoutMs,
          gracePeriodMs,
        })
      );
    }
    if (result.isError && result.error) {
      return yield* Effect.fail(
        new ExitNonZero({
          tool: result.tool,
          exitCode: result.exitCode,
          stderr: result.error,
        })
      );
    }
    return result;
  });
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
  if (!pathExists(toolPath)) {
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
