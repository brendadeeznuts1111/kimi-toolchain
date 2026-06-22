/**
 * Unified tool-runner contract for all kimi-toolchain cross-tool calls.
 *
 * Built-in tools return { output, isError }; MCP tools return { content, isError }.
 * Internal toolchain calls should use this contract so timeouts, exit codes,
 * stdout/stderr, and errors are handled consistently.
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { dedupInflight, hashInflightPayload } from "./bun-utils.ts";
import { desktopRoot } from "./paths.ts";
import { recordStep } from "./step-budget.ts";
import { classifyAndSuggest } from "./error-taxonomy.ts";
import { childTraceEnv, ensureProcessTrace, TRACE_ID_ENV } from "./effect/trace-context.ts";
import { buildTraceEvent, recordTraceEvent } from "./trace-ledger.ts";
import { applyBunInstallCacheEnvSanitizer } from "./root-hygiene.ts";

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const AGENT_TOOL_TIMEOUT_MS = 15_000;
const DEFAULT_GRACE_PERIOD_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
/** Pass as timeoutMs to invokeCommand/invokeTool to disable the watchdog. */
export const NO_TOOL_TIMEOUT_MS = 0;

const LONG_RUNNING_TOOL_FLAGS = new Set(["--watch", "--mcp-server"]);

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

/** True when argv0 resolves to the Bun runtime (PATH name, full path, or process.execPath). */
export function isBunExecutable(argv0: string): boolean {
  if (!argv0) return false;
  if (argv0 === "bun" || argv0.endsWith("/bun")) return true;
  return argv0 === process.execPath;
}

/**
 * Prepend `--no-orphans` to Bun CLI invocations so child trees die with the parent.
 * Linux/macOS only; harmless when the flag is already present.
 */
export function withBunNoOrphans(command: string[]): string[] {
  const argv0 = command[0];
  if (!argv0 || !isBunExecutable(argv0) || command.includes("--no-orphans")) return command;
  return [argv0, "--no-orphans", ...command.slice(1)];
}

/** Long-running tools (watch loops, MCP stdio servers) must not inherit the 30s router timeout. */
export function resolveToolSpawnTimeoutMs(args: string[]): number {
  if (args.some((arg) => LONG_RUNNING_TOOL_FLAGS.has(arg) || arg.startsWith("--watch-interval"))) {
    return NO_TOOL_TIMEOUT_MS;
  }
  return defaultToolTimeoutMs();
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

export interface CommandInvocationOptions extends ToolInvocationOptions {
  /** Label exposed in the returned invocation; defaults to command[0]. */
  tool?: string;
  /** Args exposed in the returned invocation; defaults to command.slice(1). */
  args?: string[];
  /** Step-budget key to record, or undefined to skip budget recording. */
  recordStepName?: string;
  /** Custom timeout message for adapters with user-facing terminology. */
  timeoutError?: (timeoutMs: number, gracePeriodMs: number) => string;
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
  timedOut?: boolean;
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
  applyBunInstallCacheEnvSanitizer(merged);
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

const inflightCommands = new Map<string, Promise<ToolInvocation>>();

function commandInflightKey(command: string[], options: CommandInvocationOptions): string {
  return hashInflightPayload({
    command,
    cwd: options.cwd || Bun.cwd,
    timeoutMs: options.timeoutMs ?? defaultToolTimeoutMs(),
    gracePeriodMs: options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS,
    maxOutputBytes: Math.max(0, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES),
    env: options.env,
  });
}

/** Clear in-flight invokeCommand dedup map (tests). */
export function clearInvokeCommandInflight(): void {
  inflightCommands.clear();
}

/** Invoke an arbitrary command with timeout, output bounds, and graceful termination. */
export async function invokeCommand(
  command: string[],
  options: CommandInvocationOptions = {}
): Promise<ToolInvocation> {
  if (command.length === 0) {
    throw new Error("Cannot invoke empty command");
  }

  const key = commandInflightKey(command, options);
  const result = await dedupInflight(inflightCommands, key, () =>
    invokeCommandOnce(command, options)
  );
  return {
    ...result,
    tool: options.tool ?? result.tool,
    args: options.args ?? result.args,
  };
}

async function invokeCommandOnce(
  command: string[],
  options: CommandInvocationOptions = {}
): Promise<ToolInvocation> {
  const cwd = options.cwd || Bun.cwd;
  const timeoutMs = options.timeoutMs ?? defaultToolTimeoutMs();
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  const maxOutputBytes = Math.max(0, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
  const start = performance.now();

  let proc: Bun.ReadableSubprocess;
  try {
    proc = Bun.spawn(withBunNoOrphans(command), {
      cwd,
      env: mergedEnv(options.env),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (e: unknown) {
    const durationMs = Math.round(performance.now() - start);
    const error = e instanceof Error ? e.message : Bun.inspect(e);
    if (options.recordStepName) {
      recordStep(options.recordStepName, durationMs, true);
    }
    return {
      tool: options.tool ?? command[0] ?? "",
      args: options.args ?? command.slice(1),
      cwd,
      timeoutMs,
      exitCode: -1,
      stdout: "",
      stderr: "",
      maxOutputBytes,
      error: `Failed to spawn command: ${error}`,
      durationMs,
      isError: true,
    };
  }

  const stdoutPromise = streamToLimitedText(proc.stdout, maxOutputBytes);
  const stderrPromise = streamToLimitedText(proc.stderr, maxOutputBytes);

  let timedOut = false;
  let sigkillTimer: ReturnType<typeof setTimeout> | null = null;

  const termTimer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
          sigkillTimer = setTimeout(() => {
            proc.kill("SIGKILL");
          }, gracePeriodMs);
        }, timeoutMs)
      : null;

  const cleanup = () => {
    if (termTimer) clearTimeout(termTimer);
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
    error = e instanceof Error ? e.message : Bun.inspect(e);
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
    if (!error) error = e instanceof Error ? e.message : Bun.inspect(e);
  }

  if (timedOut && !error) {
    error =
      options.timeoutError?.(timeoutMs, gracePeriodMs) ??
      `Command timed out after ${timeoutMs}ms (SIGTERM sent, SIGKILL after ${gracePeriodMs}ms)`;
  }

  const durationMs = Math.round(performance.now() - start);

  if (options.recordStepName) {
    recordStep(options.recordStepName, durationMs, exitCode !== 0 || !!error);
  }

  return {
    tool: options.tool ?? command[0] ?? "",
    args: options.args ?? command.slice(1),
    cwd,
    timeoutMs,
    exitCode,
    stdout,
    stderr,
    maxOutputBytes,
    ...(stdoutTruncated ? { stdoutTruncated } : {}),
    ...(stderrTruncated ? { stderrTruncated } : {}),
    ...(timedOut ? { timedOut } : {}),
    error,
    durationMs,
    isError: exitCode !== 0 || !!error,
  };
}

/** Spawn `bun` with `--no-orphans` via the unified invokeCommand contract. */
export async function spawnBun(
  args: string[],
  options?: ToolInvocationOptions
): Promise<ToolInvocation> {
  return invokeCommand(withBunNoOrphans(["bun", ...args]), options);
}

/** Invoke a tool script directly by path with timeout and graceful termination. */
export async function invokeTool(
  toolPath: string,
  args: string[],
  options: ToolInvocationOptions = {}
): Promise<ToolInvocation> {
  const startedAt = new Date().toISOString();
  const parentTraceId = options.env?.[TRACE_ID_ENV] || ensureProcessTrace().traceId;
  const traceOverlay = childTraceEnv(parentTraceId);

  const base = await invokeCommand(["bun", "run", toolPath, ...args], {
    ...options,
    env: { ...options.env, ...traceOverlay },
    tool: toolPath,
    args,
    recordStepName: toolPath,
    timeoutError: (timeoutMs, gracePeriodMs) =>
      `Tool timed out after ${timeoutMs}ms (SIGTERM sent, SIGKILL after ${gracePeriodMs}ms)`,
  });

  const traced: ToolInvocation = {
    ...base,
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
        cwd: traced.cwd,
        status: traced.isError ? "error" : "ok",
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: traced.durationMs,
        ...(traced.isError
          ? {
              error: [traced.error, traced.stderr, traced.stdout]
                .filter(Boolean)
                .join("\n")
                .slice(0, 500),
            }
          : {}),
      })
    );
  } catch {
    // Trace collection is best-effort and must not affect tool execution.
  }

  if (!traced.isError) {
    return traced;
  }

  try {
    const output = [traced.error, traced.stderr, traced.stdout].filter(Boolean).join("\n");
    const { match, suggestions } = await classifyAndSuggest(output);
    const primary = suggestions[0];
    const suggestion =
      suggestions.length > 1
        ? suggestions.map((s) => s.suggestion).join("; ")
        : (primary?.suggestion ?? match.category.suggestion ?? match.category.description);
    return {
      ...traced,
      taxonomyId: match.category.id,
      suggestion,
      autoFix: primary?.autoFix ?? match.category.autoFix,
    };
  } catch {
    return traced;
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
  if (!pathExists(toolPath)) {
    throw new Error(`Tool not found: ${toolPath}`);
  }
  return invokeTool(toolPath, args, options);
}
