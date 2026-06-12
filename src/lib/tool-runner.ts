/**
 * Unified tool-runner contract for all kimi-toolchain cross-tool calls.
 *
 * Built-in tools return { output, isError }; MCP tools return { content, isError }.
 * Internal toolchain calls should use this contract so timeouts, exit codes,
 * stdout/stderr, and errors are handled consistently.
 */

import { existsSync } from "fs";
import { join } from "path";
import { desktopRoot } from "./paths.ts";

export interface ToolInvocationOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Milliseconds to wait after SIGTERM before SIGKILL. Default 5000. */
  gracePeriodMs?: number;
}

export interface ToolInvocation {
  tool: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
  durationMs: number;
  isError: boolean;
}

/** Return the canonical tools directory path (~/.kimi-code/tools). */
export function toolsDir(): string {
  return join(desktopRoot(), "tools");
}

/** Invoke a tool script directly by path with timeout and graceful termination. */
export async function invokeTool(
  toolPath: string,
  args: string[],
  options: ToolInvocationOptions = {}
): Promise<ToolInvocation> {
  const cwd = options.cwd || Bun.cwd;
  const timeoutMs = options.timeoutMs ?? 60000;
  const gracePeriodMs = options.gracePeriodMs ?? 5000;
  const start = performance.now();

  const proc = Bun.spawn(["bun", "run", toolPath, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  let sigkillTimer: ReturnType<typeof setTimeout> | null = null;

  const termTimer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
    sigkillTimer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, gracePeriodMs);
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(termTimer);
    if (sigkillTimer) clearTimeout(sigkillTimer);
  };

  let exitCode = 0;
  let stdout = "";
  let stderr = "";
  let error: string | undefined;

  try {
    exitCode = await proc.exited;
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    cleanup();
  }

  try {
    stdout = await Bun.readableStreamToText(proc.stdout);
    stderr = await Bun.readableStreamToText(proc.stderr);
  } catch (e: unknown) {
    if (!error) error = e instanceof Error ? e.message : String(e);
  }

  if (timedOut && !error) {
    error = `Tool timed out after ${timeoutMs}ms (SIGTERM sent, SIGKILL after ${gracePeriodMs}ms)`;
  }

  const durationMs = Math.round(performance.now() - start);

  return {
    tool: toolPath,
    args,
    cwd,
    timeoutMs,
    exitCode,
    stdout,
    stderr,
    error,
    durationMs,
    isError: exitCode !== 0 || !!error,
  };
}

/**
 * Run a toolchain tool by short name (e.g., "kimi-doctor").
 * Resolves against ~/.kimi-code/tools/ and throws if the script is missing.
 */
export async function runTool(
  toolName: string,
  args: string[],
  options?: ToolInvocationOptions
): Promise<ToolInvocation> {
  const toolPath = join(toolsDir(), `${toolName}.ts`);
  if (!existsSync(toolPath)) {
    throw new Error(`Tool not found: ${toolPath}`);
  }
  return invokeTool(toolPath, args, options);
}
