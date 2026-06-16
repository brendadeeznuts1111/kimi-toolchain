/**
 * external-tool-runner.ts — Adapter layer for running external tools and turning
 * their output into HealthCheck results.
 *
 * Adapters live in `src/lib/doctor-adapters/` and implement the
 * `ExternalToolAdapter` interface. They are invoked through the shared
 * `invokeCommand` runner so timeouts and output bounds are enforced.
 */

import { Effect } from "effect";
import { existsSync } from "fs";
import { join } from "path";
import type { AdapterOutput, ExternalToolAdapter } from "./doctor-adapter-types.ts";
import { invokeCommand } from "./tool-runner.ts";
import { oxlintAdapter } from "./doctor-adapters/oxlint.ts";
import { tscAdapter } from "./doctor-adapters/tsc.ts";
import { effectGatesAdapter } from "./doctor-adapters/effect-gates.ts";
import { guardianAdapter } from "./doctor-adapters/guardian.ts";
import { governanceAdapter } from "./doctor-adapters/governance.ts";

function resolveExecutable(name: string, projectRoot: string): string {
  const fromPath = Bun.which(name);
  if (fromPath) return fromPath;
  const localBin = join(projectRoot, "node_modules", ".bin", name);
  if (existsSync(localBin)) return localBin;
  if (process.platform === "win32") {
    const cmd = join(projectRoot, "node_modules", ".bin", `${name}.cmd`);
    if (existsSync(cmd)) return cmd;
  }
  return name;
}

const ADAPTERS: Record<string, ExternalToolAdapter> = {
  oxlint: oxlintAdapter,
  typecheck: tscAdapter,
  "effect-gates": effectGatesAdapter,
  guardian: guardianAdapter,
  governance: governanceAdapter,
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS;
  const resolvedCommand = [
    resolveExecutable(adapter.command[0]!, projectRoot),
    ...adapter.command.slice(1),
  ];
  return Effect.tryPromise({
    try: () =>
      invokeCommand(resolvedCommand, {
        cwd: projectRoot,
        timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
        timeoutError: () => `adapter ${name} timed out after ${timeoutMs}ms`,
      }),
    catch: (e) =>
      ({
        adapterName: adapter.name,
        durationMs: 0,
        checks: [
          {
            name: adapter.name,
            status: "error",
            message: `adapter ${adapter.name} failed: ${e instanceof Error ? e.message : String(e)}`,
            fixable: false,
            category: "doctor_adapter_failed",
          },
        ],
      }) as AdapterOutput,
  }).pipe(
    Effect.flatMap((result) => {
      if (result.timedOut) {
        return Effect.succeed<AdapterOutput>({
          adapterName: adapter.name,
          durationMs: result.durationMs,
          checks: [
            {
              name: adapter.name,
              status: "error",
              message: `adapter ${adapter.name} timed out after ${result.timeoutMs}ms`,
              fixable: false,
              category: "doctor_adapter_timeout",
            },
          ],
        });
      }
      return Effect.succeed(adapter.parse(result));
    }),
    Effect.catchAll((output) => Effect.succeed(output))
  );
}
