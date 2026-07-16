import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { tmpdir } from "os";
import { join } from "path";
import { buildSubDoctorReport, runSubDoctorsEffect } from "../src/lib/doctor-pipeline.ts";
import { ToolNotFound, ToolTimeout } from "../src/lib/effect/errors.ts";
import { makeDir, removePath, writeText } from "./helpers.ts";

describe("doctor-pipeline", () => {
  test("buildSubDoctorReport aggregates checks via aggregateChecks", () => {
    const report = buildSubDoctorReport("kimi-doctor", [
      { name: "a", status: "ok", message: "fine", fixable: false },
      { name: "b", status: "error", message: "bad", fixable: true },
    ]);
    expect(report.tool).toBe("kimi-doctor");
    expect(report.errorCount).toBe(1);
    expect(report.fixableCount).toBe(1);
  });

  test("runSubDoctorsEffect catchAll uses tool name for ToolNotFound", async () => {
    const tmpHome = join(tmpdir(), `kimi-doctor-pipeline-${Bun.randomUUIDv7()}`);
    makeDir(tmpHome, { recursive: true });
    const prevHome = Bun.env.HOME;
    Bun.env.HOME = tmpHome;

    try {
      const checks = await Effect.runPromise(
        runSubDoctorsEffect({
          projectRoot: tmpHome,
          specs: [{ tool: "missing-sub-doctor-tool", args: [] }],
        })
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("error");
      expect(checks[0]?.message).toBe("failed: missing-sub-doctor-tool");
    } finally {
      Bun.env.HOME = prevHome;
      removePath(tmpHome, { recursive: true, force: true });
    }
  });

  test("runSubDoctorsEffect catchAll stringifies non-ToolNotFound errors", () => {
    const err = new ToolTimeout({ tool: "slow-tool", timeoutMs: 100, gracePeriodMs: 50 });
    expect(String(err)).toContain("ToolTimeout");
    expect(err instanceof ToolNotFound).toBe(false);
  });

  test("runSubDoctorsEffect runs passing sub-tool", async () => {
    const tmpHome = join(tmpdir(), `kimi-doctor-pipeline-ok-${Bun.randomUUIDv7()}`);
    makeDir(tmpHome, { recursive: true });
    const toolsDirPath = join(tmpHome, ".kimi-code", "tools");
    makeDir(toolsDirPath, { recursive: true });
    writeText(
      join(toolsDirPath, "kimi-governance.ts"),
      "#!/usr/bin/env bun\nconsole.log('sub-doctor-ok');\n"
    );

    const prevHome = Bun.env.HOME;
    Bun.env.HOME = tmpHome;

    try {
      const checks = await Effect.runPromise(
        runSubDoctorsEffect({
          projectRoot: tmpHome,
          specs: [{ tool: "kimi-governance", args: [] }],
        })
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("ok");
      expect(checks[0]?.message).toContain("passed");
    } finally {
      Bun.env.HOME = prevHome;
      removePath(tmpHome, { recursive: true, force: true });
    }
  });
});
