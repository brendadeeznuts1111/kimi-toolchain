/**
 * Normalize PostToolUseFailure hook payloads into classifiable text.
 */

export interface HookFailurePayload {
  error?: unknown;
  tool_output?: unknown;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

/** Kimi/Grok agent runtime tools — not kimi-toolchain managed contract failures. */
export const AGENT_RUNTIME_TOOL_NAMES = new Set([
  "Agent",
  "Bash",
  "Edit",
  "Glob",
  "Grep",
  "Read",
  "Task",
  "TaskOutput",
  "TaskStop",
  "Write",
  "WebFetch",
  "WebSearch",
]);

export function isAgentRuntimeToolName(toolName: string | undefined): boolean {
  if (!toolName) return false;
  return AGENT_RUNTIME_TOOL_NAMES.has(toolName);
}

/** Toolchain-managed failures (CLI, hooks on toolchain tools, scripts). */
export function isManagedLedgerFailure(record: { toolName?: string }): boolean {
  const tool = record.toolName?.trim() || "";
  if (!tool || tool === "unknown" || tool === "ledger-parser") return false;
  if (isAgentRuntimeToolName(tool)) return false;
  if (tool.startsWith("kimi-") || tool.startsWith("herdr-")) return true;
  if (tool.includes("/") || tool.includes("\\")) return true;
  if (tool === "unified-shell-bridge" || tool === "PostToolUseFailure") return true;
  return false;
}

function stringifyFailureValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "[object Object]") return null;
    return trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["message", "error", "stderr", "stdout", "output", "detail", "reason"]) {
      const nested = stringifyFailureValue(obj[key]);
      if (nested) return nested;
    }
    try {
      const json = JSON.stringify(value);
      return json && json !== "{}" ? json : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Extract classifiable failure text from a hook stdin payload. */
export function extractHookFailureText(payload: HookFailurePayload): string | null {
  const fromError = stringifyFailureValue(payload.error);
  if (fromError) return fromError;

  const fromOutput = stringifyFailureValue(payload.tool_output);
  if (fromOutput) return fromOutput;

  if (payload.tool_input && Object.keys(payload.tool_input).length > 0) {
    try {
      const hint = JSON.stringify(payload.tool_input);
      if (hint && hint !== "{}") {
        return `tool_input: ${hint}`;
      }
    } catch {
      // ignore
    }
  }

  return null;
}
