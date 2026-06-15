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
import { ToolNotFound } from "./errors.ts";

export type ToolInvocationWithTaxonomy = ToolInvocation;

/** Invoke a tool by path; taxonomy enrichment happens in invokeTool(). */
export function invokeToolEffect(
  toolPath: string,
  args: string[],
  options: ToolInvocationOptions = {}
): Effect.Effect<ToolInvocationWithTaxonomy, ToolNotFound> {
  return Effect.tryPromise({
    try: () => invokeTool(toolPath, args, options),
    catch: () => new ToolNotFound({ tool: toolPath, path: toolPath }),
  });
}

/** Run a toolchain tool by short name with typed not-found errors. */
export function runToolEffect(
  toolName: string,
  args: string[],
  options?: ToolInvocationOptions
): Effect.Effect<ToolInvocationWithTaxonomy, ToolNotFound> {
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
