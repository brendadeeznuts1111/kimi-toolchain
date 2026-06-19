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
import { childTraceEnv, ensureProcessTrace, TRACE_ID_ENV } from "./effect/trace-context.ts";
import { buildTraceEvent, recordTraceEvent } from "./trace-ledger.ts";

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const AGENT_TOOL_TIMEOUT_MS = 15_000;
const DEFAULT_GRACE_PERIOD_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
export const GIT_LOCAL_ENV_KEYS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_NAMESPACE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_OPTIONAL_LOCKS",
  "GIT_PREFIX",
  "GIT_QUARANTINE_PATH",
  "GIT_WORK_TREE",
] as const;

export function scrubProcessGitEnv(): void {
  for (const key of GIT_LOCAL_ENV_KEYS) {
    delete Bun.env[key];
  }
}

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
  /** Environment overlay for the child process. Undefined values remove keys. */
  env?: Record<string, string | undefined>;
  /** Maximum bytes retained separately for stdout and stderr. Default 1 MiB. */
  maxOutputBytes?: number;
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
  maxOutputBytes: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  error?: string;
  durationMs: number;
  isError: boolean;
  taxonomyId?: string;
  suggestion?: string;
  autoFix?: string;
  traceId?: string;
  parentTraceId?: string;
}

/** Return the canonical tools directory path (~/.kimi-code/tools). */
export function toolsDir(): string {
  return join(desktopRoot(), "tools");
}

function mergedEnv(env?: Record<string, string | undefined>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined) merged[key] = value;
  }

  for (const key of GIT_LOCAL_ENV_KEYS) {
    delete merged[key];
  }

  for (const [key, value] of Object.entries(env ?? {})) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

async function streamToLimitedText(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  if (!stream) return { text: "", truncated: false };

  const limit = Math.max(0, maxBytes);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let retainedBytes = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    const remaining = limit - retainedBytes;
    if (remaining > 0) {
      if (value.byteLength <= remaining) {
        chunks.push(value);
        retainedBytes += value.byteLength;
      } else {
        chunks.push(value.slice(0, remaining));
        retainedBytes += remaining;
        truncated = true;
      }
    } else if (value.byteLength > 0) {
      truncated = true;
    }
  }

  const retained = new Uint8Array(retainedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    retained.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { text: new TextDecoder().decode(retained), truncated };
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
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const start = performance.now();
  const startedAt = new Date().toISOString();
  const parentTraceId = options.env?.[TRACE_ID_ENV] || ensureProcessTrace().traceId;
  const traceOverlay = childTraceEnv(parentTraceId);

  const proc = Bun.spawn(["bun", "run", toolPath, ...args], {
    cwd,
    env: mergedEnv({ ...options.env, ...traceOverlay }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = streamToLimitedText(proc.stdout, maxOutputBytes);
  const stderrPromise = streamToLimitedText(proc.stderr, maxOutputBytes);

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
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let error: string | undefined;

  try {
    exitCode = await proc.exited;
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    cleanup();
  }

  try {
    const [stdoutResult, stderrResult] = await Promise.all([stdoutPromise, stderrPromise]);
    stdout = stdoutResult.text;
    stderr = stderrResult.text;
    stdoutTruncated = stdoutResult.truncated;
    stderrTruncated = stderrResult.truncated;
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
    maxOutputBytes,
    ...(stdoutTruncated ? { stdoutTruncated } : {}),
    ...(stderrTruncated ? { stderrTruncated } : {}),
    error,
    durationMs,
    isError: exitCode !== 0 || !!error,
    traceId: traceOverlay.KIMI_TRACE_ID,
    parentTraceId,
  };

  try {
    await recordTraceEvent(
      buildTraceEvent({
        traceId: parentTraceId,
        childTraceIds: [traceOverlay.KIMI_TRACE_ID],
        eventType: "subprocess",
        tool: toolPath,
        command: ["bun", "run", toolPath, ...args],
        cwd,
        status: base.isError ? "error" : "ok",
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs,
        ...(base.isError
          ? { error: [error, stderr, stdout].filter(Boolean).join("\n").slice(0, 500) }
          : {}),
      })
    );
  } catch {
    // Trace collection is best-effort and must not affect tool execution.
  }

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
