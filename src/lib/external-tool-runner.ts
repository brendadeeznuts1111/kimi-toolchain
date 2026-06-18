/**
 * external-tool-runner.ts — Adapter layer for running external tools and turning
 * their output into HealthCheck results.
 *
 * Adapters live in `src/lib/doctor-adapters/` and implement the
 * `ExternalToolAdapter` interface. They are invoked through the shared
 * `invokeCommand` runner so timeouts and output bounds are enforced.
 */

import { pathExists } from "./bun-io.ts";

import { Effect } from "effect";
import { join } from "path";
import type { AdapterOutput, ExternalToolAdapter } from "./doctor-adapter-types.ts";
import { invokeCommandEffect } from "./effect/tool-runner-effect.ts";
import { oxlintAdapter } from "./doctor-adapters/oxlint.ts";
import { tscAdapter } from "./doctor-adapters/tsc.ts";
import { effectGatesAdapter } from "./doctor-adapters/effect-gates.ts";
import { guardianAdapter } from "./doctor-adapters/guardian.ts";
import { governanceAdapter } from "./doctor-adapters/governance.ts";
import { dashboardMetaAdapter } from "./doctor-adapters/dashboard-meta.ts";
import { dashboardAutomationAdapter } from "./doctor-adapters/dashboard-automation.ts";

function resolveExecutable(name: string, projectRoot: string): string {
  const fromPath = Bun.which(name);
  if (fromPath) return fromPath;
  const localBin = join(projectRoot, "node_modules", ".bin", name);
  if (pathExists(localBin)) return localBin;
  if (process.platform === "win32") {
    const cmd = join(projectRoot, "node_modules", ".bin", `${name}.cmd`);
    if (pathExists(cmd)) return cmd;
  }
  return name;
}

const ADAPTERS: Record<string, ExternalToolAdapter> = {
  oxlint: oxlintAdapter,
  typecheck: tscAdapter,
  "effect-gates": effectGatesAdapter,
  guardian: guardianAdapter,
  governance: governanceAdapter,
  "dashboard-meta": dashboardMetaAdapter,
  "dashboard-automation": dashboardAutomationAdapter,
};

export function listExternalToolAdapters(): string[] {
  return Object.keys(ADAPTERS).sort();
}

export function getExternalToolAdapter(name: string): ExternalToolAdapter | undefined {
  return ADAPTERS[name];
}

export interface RunExternalToolAdapterOptions {
  /** Execution timeout in milliseconds. */
  timeoutMs?: number;
  /** Maximum bytes retained per stream. */
  maxOutputBytes?: number;
}

const DEFAULT_ADAPTER_TIMEOUT_MS = 30_000;
const AUTOMATION_ADAPTER_TIMEOUT_MS = 60_000;

/** Run an external-tool adapter inside an Effect. */
export function runExternalToolAdapterEffect(
  name: string,
  projectRoot: string,
  options: RunExternalToolAdapterOptions = {}
): Effect.Effect<AdapterOutput, never> {
  const adapter = ADAPTERS[name];
  if (!adapter) {
    return Effect.succeed({
      adapterName: name,
      durationMs: 0,
      checks: [
        {
          name: `adapter:${name}`,
          status: "error",
          message: `unknown adapter. Known adapters: ${listExternalToolAdapters().join(", ")}`,
          fixable: false,
          category: "external_tool_adapter_unknown",
        },
      ],
    });
  }
  const timeoutMs =
    options.timeoutMs ??
    (name === "dashboard-automation" ? AUTOMATION_ADAPTER_TIMEOUT_MS : DEFAULT_ADAPTER_TIMEOUT_MS);
  const resolvedCommand = [
    resolveExecutable(adapter.command[0]!, projectRoot),
    ...adapter.command.slice(1),
  ];
  return invokeCommandEffect(resolvedCommand, {
    cwd: projectRoot,
    tool: adapter.name,
    timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    timeoutError: () => `adapter ${name} timed out after ${timeoutMs}ms`,
  }).pipe(
    Effect.matchEffect({
      onFailure: (error) => {
        const message =
          error._tag === "ToolTimeout"
            ? `adapter ${adapter.name} timed out after ${error.timeoutMs}ms`
            : error._tag === "ToolNotFound"
              ? `adapter command not found: ${error.tool}`
              : error.stderr || `adapter ${adapter.name} failed`;
        const category =
          error._tag === "ToolTimeout" ? "doctor_adapter_timeout" : "doctor_adapter_failed";
        return Effect.succeed<AdapterOutput>({
          adapterName: adapter.name,
          durationMs: 0,
          checks: [
            {
              name: adapter.name,
              status: "error",
              message,
              fixable: false,
              category,
            },
          ],
        });
      },
      onSuccess: (result) => Effect.succeed(adapter.parse(result)),
    })
  );
}
