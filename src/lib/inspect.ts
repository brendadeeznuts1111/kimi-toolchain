import { readableStreamToText } from "./bun-utils.ts";

/**
 * inspect.ts — Bun-native inspection, equality, and ANSI helpers.
 *
 * Centralizes Bun.inspect options, table formatting, ANSI helpers, and
 * inspection streaming so callers do not open-code serialization logic.
 *
 * - Use inspectAgent() for machine-facing / --json contracts (deterministic).
 * - Use inspectHuman() + formatTable() for human-readable doctor reports and logs.
 * - Use deepEqual() / deepEqualStrict() for config and constant alignment checks.
 * - Use stripANSI() / wrapAnsi() for plain-text logs or terminal dashboards.
 * - Use customInspect when domain objects need custom inspection output.
 * - Use inspectStream() for non-blocking ReadableStream inspection.
 */

export interface InspectAgentOptions {
  /** Maximum recursion depth. Default 8. */
  depth?: number;
  /** Sort object keys for deterministic output. Default true. */
  sorted?: boolean;
  /** Include ANSI color codes. Always false for agent output. */
  colors?: false;
  /** Compact arrays/objects. Default true for JSONL-compatible stdout. */
  compact?: boolean;
}

export interface InspectHumanOptions {
  /** Maximum recursion depth. Default 4. */
  depth?: number;
  /** Sort object keys. Default true. */
  sorted?: boolean;
  /** Include ANSI color codes when supported. Default true. */
  colors?: boolean;
  /** Compact arrays/objects. Default false. */
  compact?: boolean;
}

const DEFAULT_AGENT_OPTIONS: Required<InspectAgentOptions> = {
  depth: 8,
  sorted: true,
  colors: false,
  compact: true,
};

const DEFAULT_HUMAN_OPTIONS: Required<InspectHumanOptions> = {
  depth: 4,
  sorted: true,
  colors: true,
  compact: false,
};

function serializeForAgent(
  value: unknown,
  depth: number,
  maxDepth: number,
  sorted: boolean,
  seen: WeakSet<object>
): unknown {
  if (depth > maxDepth) {
    if (Array.isArray(value)) return "[Array]";
    if (value !== null && typeof value === "object") return "[Object]";
  }

  if (typeof value === "bigint") return `${value.toString()}n`;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => serializeForAgent(item, depth + 1, maxDepth, sorted, seen));
    }

    const keys = sorted
      ? Object.keys(value as Record<string, unknown>).sort()
      : Object.keys(value as Record<string, unknown>);
    const serialized: Record<string, unknown> = {};
    for (const key of keys) {
      serialized[key] = serializeForAgent(
        (value as Record<string, unknown>)[key],
        depth + 1,
        maxDepth,
        sorted,
        seen
      );
    }
    return serialized;
  } finally {
    seen.delete(value);
  }
}

/**
 * Produce deterministic, structured JSON for machine consumption.
 * This is the canonical serializer for --json contracts.
 *
 * Guarantees:
 * - Output is compact by default so each call emits a single JSONL line.
 * - Object keys are sorted for deterministic diffing.
 * - Circular references are replaced with "[Circular]".
 * - BigInt values are serialized as strings (e.g. "42n").
 * - Values beyond `depth` are replaced with "[Object]" / "[Array]".
 */
export function inspectAgent(value: unknown, options: InspectAgentOptions = {}): string {
  const opts: Required<InspectAgentOptions> = {
    ...DEFAULT_AGENT_OPTIONS,
    ...options,
    colors: false,
  };
  const serialized = serializeForAgent(value, 0, opts.depth, opts.sorted, new WeakSet());
  return JSON.stringify(serialized, null, opts.compact ? undefined : 2);
}

/**
 * Produce human-readable, colorized output for logs and reports.
 * Suppresses colors automatically when stdout is not a TTY unless explicitly requested.
 */
export function inspectHuman(value: unknown, options: InspectHumanOptions = {}): string {
  const opts: Required<InspectHumanOptions> = { ...DEFAULT_HUMAN_OPTIONS, ...options };
  const useColors = opts.colors && !!process.stdout.isTTY;
  return Bun.inspect(value, {
    depth: opts.depth,
    sorted: opts.sorted,
    colors: useColors,
    compact: opts.compact,
  });
}

/** Format an array of objects as a human-readable table. */
export function formatTable<T extends Record<string, unknown>>(
  data: T[],
  props?: (keyof T)[],
  opts?: { colors?: boolean }
): string {
  const colors = opts?.colors ?? !!process.stdout.isTTY;
  return Bun.inspect.table(data, props as string[], { colors });
}

/** Deep equality using Bun.deepEquals (non-strict). */
export function deepEqual<T>(a: T, b: T): boolean {
  return Bun.deepEquals(a, b);
}

/** Strict deep equality using Bun.deepEquals(..., true). */
export function deepEqualStrict<T>(a: T, b: T): boolean {
  return Bun.deepEquals(a, b, true);
}

/** Strip ANSI escape codes from text. */
export function stripANSI(text: string): string {
  return Bun.stripANSI(text);
}

/** Wrap text at a given column width, respecting ANSI codes. */
export function wrapAnsi(text: string, columns: number): string {
  return Bun.wrapAnsi(text, columns);
}

/** Symbol for custom inspection implementations. */
export const customInspect: typeof Bun.inspect.custom = Bun.inspect.custom;

/** Consume a ReadableStream and return its text content. */
export async function inspectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return readableStreamToText(stream);
}
