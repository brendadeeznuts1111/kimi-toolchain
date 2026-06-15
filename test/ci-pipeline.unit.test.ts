import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { mkdirSync } from "fs";
import { join } from "path";
import { ARTIFACTS_REPORTS_DIR, artifactPath } from "../src/lib/artifacts.ts";
import type { ImpactResult } from "../src/lib/ci-impact.ts";
import {
  buildPipelineSteps,
  PipelineEnvLive,
  runFailFast,
  type PipelineStep,
} from "../src/lib/effect/ci-pipeline.ts";

describe("Effect CI pipeline planning", () => {
  test("docs-only changes skip typecheck and executable gates", () => {
    const steps = buildPipelineSteps(impact({ changeType: "docs", docsOnly: true }));
    expect(steps.map((step) => step.id)).toEqual(["success-metrics", "governance"]);
    expect(steps.map((step) => step.id)).not.toContain("quality");
    expect(steps.map((step) => step.id)).not.toContain("typecheck");
    expect(steps.map((step) => step.id)).not.toContain("security");
    expect(steps.find((step) => step.id === "governance")!.command).toContain("--fast");
  });

  test("selected tests get isolated reports and temp-home resources where needed", () => {
    const steps = buildPipelineSteps(
      impact({
        unitTests: ["test/lib.unit.test.ts"],
        integrationTests: ["test/kimi-fix.integration.test.ts"],
        smokeRequired: true,
        benchmarkIds: ["core"],
        securityRequired: true,
      })
    );
    const ids = steps.map((step) => step.id);
    expect(ids).toContain("unit");
    expect(ids).toContain("integration");
    expect(ids).toContain("smoke");
    expect(ids).toContain("benchmark");
    expect(ids).toContain("security");
    expect(ids).toContain("quality");
    expect(steps.find((step) => step.id === "unit")!.command).toContain(
      `${ARTIFACTS_REPORTS_DIR}/unit.xml`
    );
    expect(steps.find((step) => step.id === "unit")!.dependsOn).toEqual([]);
    expect(steps.find((step) => step.id === "integration")!.resources).toContain("temp-home");
    expect(steps.find((step) => step.id === "integration")!.dependsOn).toEqual(["typecheck"]);
    expect(steps.find((step) => step.id === "smoke")!.resources).toContain("temp-home");
    expect(steps.find((step) => step.id === "benchmark")!.dependsOn).toEqual(["typecheck"]);
  });

  test("full runs use complete governance score", () => {
    const steps = buildPipelineSteps(impact({ fullRequired: true }));
    expect(steps.find((step) => step.id === "governance")!.command).not.toContain("--fast");
  });

  test("governance thresholds are configurable per mode and full uses full-min", () => {
    const fastSteps = buildPipelineSteps(impact({}), { fastMinScore: 70, fullMinScore: 90 });
    const fullSteps = buildPipelineSteps(impact({ fullRequired: true }), {
      fastMinScore: 70,
      fullMinScore: 90,
    });

    expect(fastSteps.find((step) => step.id === "governance")!.command).toContain("70");
    expect(fullSteps.find((step) => step.id === "governance")!.command).toContain("90");
    expect(fullSteps.find((step) => step.id === "governance")!.command).not.toContain("70");
  });

  test("full runs always include security even when impact did not request it", () => {
    const steps = buildPipelineSteps(impact({ fullRequired: true, securityRequired: false }));
    expect(steps.map((step) => step.id)).toContain("security");
  });

  test("config-only changes use the minimal effect graph", () => {
    const steps = buildPipelineSteps(impact({ changeType: "config" }));
    expect(steps.map((step) => step.id)).toEqual(["success-metrics", "governance"]);
  });

  test("fail-fast executor interrupts sibling subprocesses", async () => {
    const repoRoot = join(import.meta.dir, "..");
    const marker = artifactPath(repoRoot, "tmp", ".tmp-fail-fast-marker");
    mkdirSync(artifactPath(repoRoot, "tmp"), { recursive: true });
    await Bun.file(marker)
      .delete()
      .catch(() => undefined);
    const steps: PipelineStep[] = [
      {
        id: "slow",
        command: [
          "bun",
          "-e",
          `await Bun.sleep(250); await Bun.write(${JSON.stringify(marker)}, "late")`,
        ],
        dependsOn: [],
        resources: ["process"],
      },
      {
        id: "fail",
        command: ["bun", "-e", "process.exit(7)"],
        dependsOn: [],
        resources: ["process"],
      },
    ];

    const started = Date.now();
    const exit = await Effect.runPromiseExit(
      runFailFast(steps, 2).pipe(Effect.provide(PipelineEnvLive({ repoRoot })))
    );
    const durationMs = Date.now() - started;
    await Bun.sleep(300);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(durationMs).toBeLessThan(220);
    expect(await Bun.file(marker).exists()).toBe(false);
  });
});

function impact(overrides: Partial<ImpactResult>): ImpactResult {
  return {
    changedFiles: [],
    changeType: "source",
    docsOnly: false,
    fullRequired: false,
    fullReason: null,
    affectedFiles: [],
    unmatchedRiskyFiles: [],
    unitTests: [],
    integrationTests: [],
    smokeRequired: false,
    benchmarkIds: [],
    securityRequired: false,
    matrix: [],
    ...overrides,
  };
}
