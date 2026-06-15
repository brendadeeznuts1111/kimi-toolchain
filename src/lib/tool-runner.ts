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
import { recordStep } from "./step-budget.ts";
import { classifyAndSuggest } from "./error-taxonomy.ts";

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const AGENT_TOOL_TIMEOUT_MS = 15_000;
const DEFAULT_GRACE_PERIOD_MS = 5_000;

/** Detect if running inside an agent session (Kimi Code loop, CI, etc.). */
export function isAgentContext(): boolean {
  return !!(
    Bun.env.KIMI_AGENT_SESSION ||
    Bun.env.KIMI_CODE_SESSION ||
    Bun.env.CI ||
    Bun.env.GITHUB_ACTIONS ||
    Bun.env.GITLAB_CI
  );
}

export function defaultToolTimeoutMs(): number {
  return isAgentContext() ? AGENT_TOOL_TIMEOUT_MS : DEFAULT_TOOL_TIMEOUT_MS;
}

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
  taxonomyId?: string;
  suggestion?: string;
  autoFix?: string;
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
  const timeoutMs = options.timeoutMs ?? defaultToolTimeoutMs();
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
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

  recordStep(toolPath, durationMs, exitCode !== 0 || !!error);

  const base: ToolInvocation = {
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

  if (!base.isError) {
    return base;
  }

  try {
    const output = [error, stderr, stdout].filter(Boolean).join("\n");
    const { match, suggestions } = await classifyAndSuggest(output);
    const primary = suggestions[0];
    const suggestion =
      suggestions.length > 1
        ? suggestions.map((s) => s.suggestion).join("; ")
        : (primary?.suggestion ?? match.category.suggestion ?? match.category.description);
    return {
      ...base,
      taxonomyId: match.category.id,
      suggestion,
      autoFix: primary?.autoFix ?? match.category.autoFix,
    };
  } catch {
    return base;
  }
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
