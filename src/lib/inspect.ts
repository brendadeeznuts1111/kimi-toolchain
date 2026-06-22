import { readableStreamToText, terminalWidth } from "./bun-utils.ts";

/**
 * inspect.ts — Bun-native inspection, equality, and ANSI helpers.
 *
 * Centralizes Bun.inspect options, table formatting, ANSI helpers, and
 * inspection streaming so callers do not open-code serialization logic.
 *
 * - Use inspectAgent() for machine-facing / --json contracts (deterministic).
 * - Use inspectHuman() + formatTable() for human-readable doctor reports and logs.
 * - Use deepEqual() / deepEqualStrict() for config and constant alignment checks.
 * - Use stripANSI() / wrapAnsi() / sliceAnsi() for plain-text logs or terminal dashboards.
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

export type InspectPreset = "auto" | "debug" | "development" | "production" | "compact";

export interface InspectPresetOptions {
  depth?: number;
  colors?: boolean;
  compact?: boolean;
  sorted?: boolean;
  maxArrayLength?: number;
  showHidden?: boolean;
  breakLength?: number;
}

export interface ConfigureInspectOptions extends InspectPresetOptions {
  /** Environment map used for detection. Defaults to Bun.env. */
  env?: Record<string, string | undefined>;
  /** TTY probe used for detection. Defaults to process.stdout.isTTY. */
  isTTY?: boolean;
}

export interface InspectPresetConfig extends Required<InspectPresetOptions> {
  preset: InspectPreset;
  forcedDebug: boolean;
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

const DEBUG_INSPECT_VALUES = new Set(["1", "true", "yes", "on"]);

type BunInspectWithOptions = typeof Bun.inspect & { options?: InspectPresetOptions };

const ORIGINAL_BUN_INSPECT = Bun.inspect;
let inspectWrapperInstalled = false;

function installInspectPresetWrapper(): void {
  if (inspectWrapperInstalled) return;

  const current = Bun.inspect as BunInspectWithOptions;
  const wrapped = ((value: unknown, options?: Parameters<typeof Bun.inspect>[1]) => {
    const defaults = (wrapped as BunInspectWithOptions).options ?? {};
    return ORIGINAL_BUN_INSPECT(value, { ...defaults, ...options });
  }) as BunInspectWithOptions;

  Object.defineProperties(wrapped, {
    custom: {
      value: ORIGINAL_BUN_INSPECT.custom,
      writable: true,
      enumerable: true,
      configurable: true,
    },
    table: {
      value: ORIGINAL_BUN_INSPECT.table,
      writable: true,
      enumerable: true,
      configurable: true,
    },
  });
  wrapped.options = current.options ?? {};
  (Bun as unknown as { inspect: typeof Bun.inspect }).inspect = wrapped;
  inspectWrapperInstalled = true;
}

function bunInspectOptions(): InspectPresetOptions {
  installInspectPresetWrapper();
  const inspect = Bun.inspect as BunInspectWithOptions;
  if (!inspect.options) inspect.options = {};
  return inspect.options;
}

function inspectPresetConfig(
  preset: InspectPreset,
  isTTY: boolean,
  env: Record<string, string | undefined>
): Required<InspectPresetOptions> {
  const production = env.NODE_ENV === "production";
  if (preset === "debug") {
    return {
      depth: Infinity,
      colors: isTTY,
      compact: false,
      sorted: true,
      maxArrayLength: Infinity,
      showHidden: true,
      breakLength: Infinity,
    };
  }
  if (preset === "production" || (preset === "auto" && production)) {
    return {
      depth: 2,
      colors: false,
      compact: true,
      sorted: false,
      maxArrayLength: 30,
      showHidden: false,
      breakLength: 80,
    };
  }
  if (preset === "compact") {
    return {
      depth: 3,
      colors: false,
      compact: true,
      sorted: false,
      maxArrayLength: 50,
      showHidden: false,
      breakLength: 60,
    };
  }
  if (preset === "development" || isTTY) {
    return {
      depth: 5,
      colors: isTTY,
      compact: false,
      sorted: true,
      maxArrayLength: Infinity,
      showHidden: false,
      breakLength: 120,
    };
  }
  return {
    depth: 4,
    colors: false,
    compact: true,
    sorted: true,
    maxArrayLength: 100,
    showHidden: false,
    breakLength: 80,
  };
}

function debugInspectForced(env: Record<string, string | undefined>): boolean {
  const raw = env.DEBUG_INSPECT;
  return raw != null && DEBUG_INSPECT_VALUES.has(String(raw).toLowerCase());
}

/**
 * Configure Bun.inspect with runtime-aware presets.
 *
 * DEBUG_INSPECT=1|true|yes|on forces the debug preset before caller overrides.
 * Caller overrides are applied last and returned with the effective preset.
 */
export function configureInspect(
  preset: InspectPreset = "auto",
  options: ConfigureInspectOptions = {}
): InspectPresetConfig {
  const { env = Bun.env, isTTY = process.stdout?.isTTY ?? false, ...overrides } = options;
  const forcedDebug = debugInspectForced(env);
  const effectivePreset: InspectPreset = forcedDebug ? "debug" : preset;
  const config: Required<InspectPresetOptions> = {
    ...inspectPresetConfig(effectivePreset, isTTY, env),
    ...overrides,
  };

  Object.assign(bunInspectOptions(), {
    depth: config.depth,
    colors: config.colors,
    compact: config.compact,
    sorted: config.sorted,
    maxArrayLength: config.maxArrayLength,
    showHidden: config.showHidden,
    breakLength: config.breakLength,
  });

  return { preset: effectivePreset, forcedDebug, ...config };
}

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

export type WrapAnsiOptions = NonNullable<Parameters<typeof Bun.wrapAnsi>[2]>;

/** Wrap text at a given column width, respecting ANSI codes. */
export function wrapAnsi(text: string, columns: number, options?: WrapAnsiOptions): string {
  return Bun.wrapAnsi(text, columns, options);
}

/** Slice or truncate text by terminal display width, preserving ANSI codes. */
export function sliceAnsi(text: string, start?: number, end?: number, ellipsis?: string): string {
  if (ellipsis === undefined) return Bun.sliceAnsi(text, start, end);
  return Bun.sliceAnsi(text, start, end, ellipsis);
}

/** Truncate text to a terminal column budget (ANSI- and wide-char aware). */
export function truncateTerminal(text: string, maxCols: number, ellipsis = "…"): string {
  if (terminalWidth(text) <= maxCols) return text;
  return sliceAnsi(text, 0, maxCols, ellipsis);
}

/** Symbol for custom inspection implementations. */
export const customInspect: typeof Bun.inspect.custom = Bun.inspect.custom;

/** Consume a ReadableStream and return its text content. */
export async function inspectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return readableStreamToText(stream);
}
