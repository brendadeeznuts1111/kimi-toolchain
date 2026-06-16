/**
 * doctor-plugins.ts — Project/user plugin registry for custom kimi-doctor checks.
 *
 * Plugins are executables that return a JSON envelope of HealthCheck results.
 * They run through the existing tool-runner so they inherit timeouts, output
 * bounds, and graceful termination.
 */

import { join, resolve } from "path";
import { existsSync } from "fs";
import { Effect } from "effect";
import type { HealthCheck } from "./health-check.ts";
import { homeDir } from "./paths.ts";
import { invokeCommand, type ToolInvocation } from "./tool-runner.ts";
import { log, safeParse } from "./utils.ts";

export const DOCTOR_PLUGIN_SCHEMA_VERSION = 1;
export const DEFAULT_PLUGIN_TIMEOUT_MS = 30_000;

export interface DoctorPluginSpec {
  /** Human-readable check name. */
  name: string;
  /** Executable to run. */
  command: string;
  /** Arguments passed to the executable. */
  args?: string[];
  /** Working directory; defaults to project root. */
  cwd?: string;
  /** Optional timeout override in milliseconds. */
  timeoutMs?: number;
  /** Optional retained output limit per stream. */
  maxOutputBytes?: number;
}

export interface DoctorPluginManifest {
  schemaVersion: number;
  plugins: DoctorPluginSpec[];
}

export interface DoctorPluginEntry {
  /** Valid plugin spec. */
  plugin: DoctorPluginSpec;
  /** Invalid plugin record. */
  invalid?: never;
}

export interface DoctorPluginInvalidEntry {
  /** Plugin name if available. */
  name: string;
  /** Human-readable validation error. */
  error: string;
  plugin?: never;
  invalid: true;
}

export type DoctorPluginDiscoveryResult = DoctorPluginEntry | DoctorPluginInvalidEntry;

export function isInvalidPluginEntry(
  entry: DoctorPluginDiscoveryResult
): entry is DoctorPluginInvalidEntry {
  return "invalid" in entry && entry.invalid === true;
}

export interface DoctorPluginRunOptions {
  projectRoot: string;
  /** User home for loading global plugins. */
  home?: string;
  /** If provided, only run the plugin with this name. */
  only?: string;
}

const defaultCheck = (
  name: string,
  status: HealthCheck["status"],
  message: string,
  category = "doctor_plugin_failed"
): HealthCheck => ({
  name,
  status,
  message,
  fixable: false,
  category,
});

function isValidPluginSpec(
  item: unknown
): { valid: true; spec: DoctorPluginSpec } | { valid: false; reason: string } {
  if (typeof item !== "object" || item === null) {
    return { valid: false, reason: "plugin entry is not an object" };
  }
  const p = item as Record<string, unknown>;

  if (typeof p.name !== "string" || p.name.trim().length === 0) {
    return { valid: false, reason: "missing or empty plugin name" };
  }
  if (p.name.includes(" ")) {
    return { valid: false, reason: "plugin name must not contain spaces" };
  }

  if (typeof p.command !== "string" || p.command.trim().length === 0) {
    return { valid: false, reason: "missing or empty command" };
  }

  const spec: DoctorPluginSpec = { name: p.name.trim(), command: p.command.trim() };

  if (p.args !== undefined) {
    if (!Array.isArray(p.args) || !p.args.every((a) => typeof a === "string")) {
      return { valid: false, reason: "args must be an array of strings" };
    }
    spec.args = p.args as string[];
  }

  if (p.cwd !== undefined) {
    if (typeof p.cwd !== "string") {
      return { valid: false, reason: "cwd must be a string" };
    }
    spec.cwd = p.cwd;
  }

  if (p.timeoutMs !== undefined) {
    if (typeof p.timeoutMs !== "number" || !Number.isFinite(p.timeoutMs) || p.timeoutMs <= 0) {
      return { valid: false, reason: "timeoutMs must be a finite positive number" };
    }
    spec.timeoutMs = p.timeoutMs;
  }

  if (p.maxOutputBytes !== undefined) {
    if (
      typeof p.maxOutputBytes !== "number" ||
      !Number.isFinite(p.maxOutputBytes) ||
      p.maxOutputBytes <= 0
    ) {
      return { valid: false, reason: "maxOutputBytes must be a finite positive number" };
    }
    spec.maxOutputBytes = p.maxOutputBytes;
  }

  return { valid: true, spec };
}

interface RawManifest {
  schemaVersion: number;
  plugins: unknown[];
  error?: string;
}

function readRawManifest(path: string, raw: unknown): RawManifest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== DOCTOR_PLUGIN_SCHEMA_VERSION) return null;
  if (!Array.isArray(obj.plugins)) return null;
  return { schemaVersion: DOCTOR_PLUGIN_SCHEMA_VERSION, plugins: obj.plugins };
}

async function readManifest(path: string): Promise<RawManifest | null> {
  if (!existsSync(path)) return null;
  const text = await Bun.file(path).text();
  const parsed = safeParse<unknown>(text, null);
  if (parsed === null) return null;
  return readRawManifest(path, parsed);
}

/** Validate that a plugin command is executable on PATH. */
function validateCommandOnPath(spec: DoctorPluginSpec): DoctorPluginDiscoveryResult {
  const resolved = Bun.which(spec.command);
  if (!resolved) {
    return {
      name: spec.name,
      invalid: true,
      error: `command "${spec.command}" not found on PATH`,
    };
  }
  return { plugin: spec };
}

/**
 * Discover plugin manifests from project and user directories.
 *
 * Project-local plugins override user-global plugins by name. A warning is
 * logged to stderr when a collision occurs.
 */
export async function discoverDoctorPlugins(options: {
  projectRoot: string;
  home?: string;
}): Promise<DoctorPluginDiscoveryResult[]> {
  const home = options.home ?? homeDir();
  const projectManifestPath = join(options.projectRoot, ".kimi", "doctor-plugins.json");
  const userManifestPath = join(home, ".kimi-code", "doctor-plugins.json");

  const userManifest = await readManifest(userManifestPath);
  const projectManifest = await readManifest(projectManifestPath);

  const byName = new Map<string, unknown>();

  if (userManifest) {
    for (const plugin of userManifest.plugins) {
      const name =
        typeof plugin === "object" && plugin !== null && "name" in plugin
          ? String((plugin as Record<string, unknown>).name)
          : "";
      byName.set(name || `__anonymous_${byName.size}`, plugin);
    }
  }

  if (projectManifest) {
    for (const plugin of projectManifest.plugins) {
      const name =
        typeof plugin === "object" && plugin !== null && "name" in plugin
          ? String((plugin as Record<string, unknown>).name)
          : "";
      const key = name || `__anonymous_${byName.size}`;
      if (byName.has(key) && name) {
        log("warn", `Plugin collision: project-local "${name}" overrides user-global plugin`);
      }
      byName.set(key, plugin);
    }
  }

  const results: DoctorPluginDiscoveryResult[] = [];
  for (const raw of byName.values()) {
    const validated = isValidPluginSpec(raw);
    if (!validated.valid) {
      const fallbackName =
        typeof raw === "object" &&
        raw !== null &&
        "name" in raw &&
        typeof (raw as Record<string, unknown>).name === "string"
          ? String((raw as Record<string, unknown>).name)
          : "unknown";
      results.push({ name: fallbackName || "unknown", invalid: true, error: validated.reason });
      continue;
    }
    results.push(validateCommandOnPath(validated.spec));
  }

  return results;
}

function parsePluginOutput(result: ToolInvocation, name: string): HealthCheck[] {
  if (result.timedOut) {
    return [defaultCheck(name, "error", `plugin timed out after ${result.timeoutMs}ms`)];
  }
  if (result.error) {
    return [defaultCheck(name, "error", `plugin failed to spawn: ${result.error}`)];
  }
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim().slice(0, 200) || `exit ${result.exitCode}`;
    return [defaultCheck(name, "error", `plugin exited ${result.exitCode}: ${detail}`)];
  }
  const parsed = safeParse<{ checks?: unknown[] }>(result.stdout, { checks: [] });
  if (!Array.isArray(parsed.checks)) {
    return [defaultCheck(name, "error", "plugin output missing checks array")];
  }
  const checks: HealthCheck[] = [];
  for (const item of parsed.checks) {
    if (
      item !== null &&
      typeof item === "object" &&
      "name" in item &&
      typeof (item as Record<string, unknown>).name === "string" &&
      "status" in item &&
      ["ok", "warn", "error"].includes((item as Record<string, unknown>).status as string) &&
      "message" in item &&
      typeof (item as Record<string, unknown>).message === "string"
    ) {
      checks.push(item as HealthCheck);
    } else {
      checks.push(
        defaultCheck(name, "error", `plugin returned invalid check: ${JSON.stringify(item)}`)
      );
    }
  }
  if (checks.length === 0) {
    checks.push(defaultCheck(name, "ok", "plugin reported no checks"));
  }
  return checks;
}

/** Run a single plugin and return its HealthChecks wrapped in an Effect. */
export function runDoctorPluginEffect(
  plugin: DoctorPluginSpec,
  projectRoot: string
): Effect.Effect<HealthCheck[], never> {
  return Effect.tryPromise(async () => {
    const cwd = plugin.cwd ? resolve(projectRoot, plugin.cwd) : projectRoot;
    const result = await invokeCommand([plugin.command, ...(plugin.args ?? [])], {
      cwd,
      timeoutMs: plugin.timeoutMs ?? DEFAULT_PLUGIN_TIMEOUT_MS,
      maxOutputBytes: plugin.maxOutputBytes,
      timeoutError: (timeoutMs) => `plugin ${plugin.name} timed out after ${timeoutMs}ms`,
    });
    return parsePluginOutput(result, plugin.name);
  }).pipe(
    Effect.catchAll((e) =>
      Effect.succeed([
        defaultCheck(plugin.name, "error", e instanceof Error ? e.message : String(e)),
      ])
    )
  );
}

/** Build a synthetic error check for an invalid plugin entry. */
function invalidPluginCheck(entry: DoctorPluginInvalidEntry): HealthCheck {
  return {
    name: `plugin:${entry.name}`,
    status: "error",
    message: `invalid plugin '${entry.name}': ${entry.error}`,
    fixable: false,
    category: "doctor_plugin_invalid",
  };
}

/** Run all discovered plugins, or a single named plugin if `only` is set. */
export function runDoctorPluginsEffect(
  options: DoctorPluginRunOptions
): Effect.Effect<HealthCheck[], never> {
  return Effect.gen(function* () {
    const discovered = yield* Effect.tryPromise(() => discoverDoctorPlugins(options)).pipe(
      Effect.catchAll(() => Effect.succeed([] as DoctorPluginDiscoveryResult[]))
    );

    const invalidChecks = discovered
      .filter((r): r is DoctorPluginInvalidEntry => "invalid" in r)
      .map(invalidPluginCheck);

    const validPlugins = discovered
      .filter((r): r is DoctorPluginEntry => "plugin" in r)
      .map((r) => r.plugin);

    const selected = options.only
      ? validPlugins.filter((p) => p.name === options.only)
      : validPlugins;

    if (selected.length === 0) {
      return invalidChecks;
    }

    const results = yield* Effect.all(
      selected.map((p) => runDoctorPluginEffect(p, options.projectRoot))
    );
    return [...invalidChecks, ...results.flat()];
  });
}
