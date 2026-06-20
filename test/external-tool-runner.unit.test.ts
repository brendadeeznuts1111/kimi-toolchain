import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { ToolInvocation } from "../src/lib/tool-runner.ts";
import { tscAdapter } from "../src/lib/doctor-adapters/tsc.ts";
import { effectGatesAdapter } from "../src/lib/doctor-adapters/effect-gates.ts";
import { guardianAdapter } from "../src/lib/doctor-adapters/guardian.ts";
import { governanceAdapter } from "../src/lib/doctor-adapters/governance.ts";
import {
  listExternalToolAdapters,
  runExternalToolAdapterEffect,
} from "../src/lib/external-tool-runner.ts";
import { REPO_ROOT } from "./helpers.ts";

function mockInvocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    tool: "mock",
    args: [],
    cwd: REPO_ROOT,
    timeoutMs: 30_000,
    exitCode: 0,
    stdout: "",
    stderr: "",
    maxOutputBytes: 1_048_576,
    durationMs: 100,
    isError: false,
    ...overrides,
  };
}

describe("external-tool-runner adapters", () => {
  test("lists registered adapters", () => {
    const adapters = listExternalToolAdapters();
    expect(adapters).toContain("effect-gates");
    expect(adapters).toContain("guardian");
    expect(adapters).toContain("governance");
    expect(adapters).toContain("oxlint");
    expect(adapters).toContain("typecheck");
  });

  test("typecheck adapter parses ok result", () => {
    const output = tscAdapter.parse(mockInvocation({ exitCode: 0, stdout: "no type errors\n" }));
    expect(output.adapterName).toBe("typecheck");
    expect(output.checks[0]?.name).toBe("typecheck");
    expect(output.checks[0]?.status).toBe("ok");
  });

  test("typecheck adapter parses type errors", () => {
    const output = tscAdapter.parse(
      mockInvocation({ exitCode: 1, stdout: "src/lib/foo.ts(1,1): error TS1234\n" })
    );
    expect(output.adapterName).toBe("typecheck");
    expect(output.checks[0]?.name).toBe("typecheck");
    expect(output.checks[0]?.status).toBe("error");
    expect(output.checks[0]?.message).toContain("src/lib/foo.ts");
  });

  test("typecheck adapter sets NODE_OPTIONS for large projects", () => {
    expect(tscAdapter.env?.NODE_OPTIONS).toBe("--max-old-space-size=8192");
  });

  test("effect-gates adapter parses clean report", () => {
    const output = effectGatesAdapter.parse(
      mockInvocation({
        stdout: JSON.stringify({
          effectGates: {
            current: {
              schemaVersion: 1,
              project: "demo",
              tool: "kimi-doctor",
              generatedAt: new Date().toISOString(),
              gitHead: "abc",
              counts: {
                directPromise: 0,
                domainPurity: 0,
                eventStream: 0,
                layerCircularity: 0,
                missingServiceTag: 0,
                runPromiseBoundary: 0,
              },
              thresholds: {},
              summary: { errors: 0, warnings: 0, total: 0 },
              violations: [],
            },
            regressions: [],
          },
        }),
      })
    );
    expect(output.adapterName).toBe("effect-gates");
    expect(output.checks[0]?.name).toBe("effect-gates");
    expect(output.checks[0]?.status).toBe("ok");
    expect(output.checks[0]?.message).toContain("clean");
  });

  test("effect-gates adapter parses report with violations", () => {
    const output = effectGatesAdapter.parse(
      mockInvocation({
        stdout: JSON.stringify({
          effectGates: {
            current: {
              schemaVersion: 1,
              project: "demo",
              tool: "kimi-doctor",
              generatedAt: new Date().toISOString(),
              gitHead: "abc",
              counts: {
                directPromise: 2,
                domainPurity: 0,
                eventStream: 0,
                layerCircularity: 0,
                missingServiceTag: 0,
                runPromiseBoundary: 1,
              },
              thresholds: {},
              summary: { errors: 3, warnings: 0, total: 3 },
              violations: [],
            },
            regressions: [],
          },
        }),
      })
    );
    expect(output.adapterName).toBe("effect-gates");
    expect(output.checks[0]?.name).toBe("effect-gates");
    expect(output.checks[0]?.status).toBe("error");
  });

  test("guardian adapter parses clean result", () => {
    const output = guardianAdapter.parse(
      mockInvocation({
        stdout: JSON.stringify({
          schemaVersion: 1,
          tool: "kimi-guardian",
          check: { name: "lockfile", status: "ok", message: "clean" },
        }),
      })
    );
    expect(output.adapterName).toBe("guardian");
    expect(output.checks[0]?.name).toBe("guardian");
    expect(output.checks[0]?.status).toBe("ok");
  });

  test("guardian adapter parses blockers", () => {
    const output = guardianAdapter.parse(
      mockInvocation({
        stdout: JSON.stringify({
          schemaVersion: 1,
          tool: "kimi-guardian",
          check: { name: "lockfile", status: "error", message: "hash mismatch" },
        }),
      })
    );
    expect(output.adapterName).toBe("guardian");
    expect(output.checks[0]?.status).toBe("error");
  });

  test("governance adapter parses passing grade", () => {
    const output = governanceAdapter.parse(
      mockInvocation({
        stdout: JSON.stringify({
          schemaVersion: 1,
          tool: "kimi-governance",
          summary: { ok: true, grade: "A" },
          score: { grade: "A", total: 95, max: 100 },
        }),
      })
    );
    expect(output.adapterName).toBe("governance");
    expect(output.checks[0]?.name).toBe("governance");
    expect(output.checks[0]?.status).toBe("ok");
  });

  test("governance adapter parses failing grade", () => {
    const output = governanceAdapter.parse(
      mockInvocation({
        stdout: JSON.stringify({
          schemaVersion: 1,
          tool: "kimi-governance",
          summary: { ok: false, grade: "D" },
          score: { grade: "D", total: 55, max: 100 },
        }),
      })
    );
    expect(output.adapterName).toBe("governance");
    expect(output.checks[0]?.status).toBe("error");
    expect(output.checks[0]?.message).toContain("D");
  });

  test("unknown adapter returns error check", async () => {
    const output = await Effect.runPromise(runExternalToolAdapterEffect("not-real", REPO_ROOT));
    expect(output.adapterName).toBe("not-real");
    expect(output.checks[0]?.status).toBe("error");
    expect(output.checks[0]?.message).toContain("unknown adapter");
  });

  test("adapter timeout returns timeout category", async () => {
    const output = await Effect.runPromise(
      runExternalToolAdapterEffect("typecheck", REPO_ROOT, { timeoutMs: 1 })
    );
    expect(output.checks[0]?.status).toBe("error");
    expect(output.checks[0]?.category).toBe("doctor_adapter_timeout");
    expect(output.checks[0]?.message).toContain("timed out");
  }, 10_000);
});
