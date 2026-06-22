import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "path";
import {
  buildEffectGatesReport,
  appendEffectGatesSnapshot,
  readEffectGatesSnapshots,
  deriveSessionCountsFromSnapshots,
  detectRegressions,
  evaluateSessionFloor,
  EFFECT_GATES,
  EFFECT_GATES_REPORT_SCHEMA_VERSION,
} from "../src/lib/effect-gates.ts";

describe("effect-gates", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = Bun.fileURLToPath(
      new URL(
        `./effect-gates-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        "file:///tmp/"
      )
    );
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await mkdir(join(tmpDir, ".kimi", "var"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("reports no violations for empty source tree", async () => {
    const report = await buildEffectGatesReport({ projectRoot: tmpDir, tool: "test" });
    expect(report.schemaVersion).toBe(EFFECT_GATES_REPORT_SCHEMA_VERSION);
    expect(report.tool).toBe("test");
    expect(report.violations).toHaveLength(0);
    expect(report.summary.total).toBe(0);
  });

  test("detects bare Promise usage", async () => {
    await writeFile(
      join(tmpDir, "src", "service.ts"),
      `export function fetchUser() { return fetch("/user").then(r => r.json()); }`
    );

    const report = await buildEffectGatesReport({ projectRoot: tmpDir, tool: "test" });
    const promiseViolations = report.violations.filter(
      (v) => v.gate === EFFECT_GATES.directPromise
    );
    expect(promiseViolations.length).toBeGreaterThan(0);
    expect(promiseViolations[0].message).toContain(".then()");
  });

  test("ignores Promise usage inside comments and strings", async () => {
    await writeFile(
      join(tmpDir, "src", "service.ts"),
      `
        // return fetch("/user").then(r => r.json());
        const hint = 'use fetch("/user").then(r => r.json())';
      `
    );

    const report = await buildEffectGatesReport({ projectRoot: tmpDir, tool: "test" });
    const promiseViolations = report.violations.filter(
      (v) => v.gate === EFFECT_GATES.directPromise
    );
    expect(promiseViolations).toHaveLength(0);
  });

  test("detects missing service Tag/Layer on exported class", async () => {
    await writeFile(
      join(tmpDir, "src", "service.ts"),
      `
        import { Effect } from "effect";
        export class UserService {
          findById(id: string) { return Effect.succeed(id); }
        }
      `
    );

    const report = await buildEffectGatesReport({ projectRoot: tmpDir, tool: "test" });
    const tagViolations = report.violations.filter(
      (v) => v.gate === EFFECT_GATES.missingServiceTag
    );
    expect(tagViolations.length).toBe(1);
    expect(tagViolations[0].message).toContain("UserService");
  });

  test("detects domain purity violations", async () => {
    await mkdir(join(tmpDir, "src", "domain"), { recursive: true });
    await writeFile(
      join(tmpDir, "src", "domain", "service.ts"),
      `export function config() { return Bun.env.FOO; }`
    );

    const report = await buildEffectGatesReport({ projectRoot: tmpDir, tool: "test" });
    const purityViolations = report.violations.filter((v) => v.gate === EFFECT_GATES.domainPurity);
    expect(purityViolations.length).toBe(1);
    expect(purityViolations[0].message).toContain("Bun.env access");
  });

  test("detects Effect.runPromise outside permitted boundary", async () => {
    await mkdir(join(tmpDir, "src", "lib"), { recursive: true });
    await writeFile(
      join(tmpDir, "src", "lib", "service.ts"),
      `import { Effect } from "effect"; export function run() { return Effect.runPromise(Effect.succeed(1)); }`
    );

    const report = await buildEffectGatesReport({ projectRoot: tmpDir, tool: "test" });
    const boundaryViolations = report.violations.filter(
      (v) => v.gate === EFFECT_GATES.runPromiseBoundary
    );
    expect(boundaryViolations.length).toBe(1);
    expect(boundaryViolations[0].message).toContain("Effect.runPromise");
    expect(boundaryViolations[0].location).toContain("src/lib/service.ts");
  });

  test("allows Effect.runPromise inside permitted boundaries", async () => {
    await mkdir(join(tmpDir, "src", "bin"), { recursive: true });
    await mkdir(join(tmpDir, "test"), { recursive: true });
    await writeFile(
      join(tmpDir, "src", "bin", "run.ts"),
      `import { Effect } from "effect"; Effect.runPromise(Effect.succeed(1));`
    );
    await writeFile(
      join(tmpDir, "test", "foo.unit.test.ts"),
      `import { Effect } from "effect"; Effect.runPromise(Effect.succeed(1));`
    );

    const report = await buildEffectGatesReport({
      projectRoot: tmpDir,
      tool: "test",
      include: ["src/**/*.ts", "test/**/*.ts"],
    });
    const boundaryViolations = report.violations.filter(
      (v) => v.gate === EFFECT_GATES.runPromiseBoundary
    );
    expect(boundaryViolations).toHaveLength(0);
  });

  test("detects EventEmitter usage in src/services when event-streams enabled", async () => {
    await mkdir(join(tmpDir, "src", "services"), { recursive: true });
    await writeFile(
      join(tmpDir, "src", "services", "broker.ts"),
      `import { EventEmitter } from "events"; export const broker = new EventEmitter();`
    );

    const report = await buildEffectGatesReport({
      projectRoot: tmpDir,
      tool: "test",
      thresholdOverrides: { eventStreamsEnabled: true },
    });
    const streamViolations = report.violations.filter((v) => v.gate === EFFECT_GATES.eventStream);
    expect(streamViolations.length).toBeGreaterThan(0);
    expect(streamViolations[0].message).toContain("EventEmitter");
  });

  test("ignores EventEmitter usage outside src/services", async () => {
    await mkdir(join(tmpDir, "src", "lib"), { recursive: true });
    await writeFile(
      join(tmpDir, "src", "lib", "broker.ts"),
      `import { EventEmitter } from "events"; export const broker = new EventEmitter();`
    );

    const report = await buildEffectGatesReport({
      projectRoot: tmpDir,
      tool: "test",
      thresholdOverrides: { eventStreamsEnabled: true },
    });
    const streamViolations = report.violations.filter((v) => v.gate === EFFECT_GATES.eventStream);
    expect(streamViolations).toHaveLength(0);
  });

  test("evaluates session floor as passed when all counts meet thresholds", () => {
    const result = evaluateSessionFloor({
      rawPromisesRemoved: 2,
      servicesMigratedToTagLayer: 2,
      domainPurityViolationsResolved: 1,
      rawErrorsConvertedToTyped: 1,
      eventEmittersConvertedToStreams: 0,
      circularLayerDependencies: 0,
    });
    expect(result.passed).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.below).toHaveLength(0);
  });

  test("evaluates session floor as failed when a field is missing", () => {
    const result = evaluateSessionFloor({
      rawPromisesRemoved: 2,
      servicesMigratedToTagLayer: 2,
      domainPurityViolationsResolved: 1,
      rawErrorsConvertedToTyped: 1,
      eventEmittersConvertedToStreams: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.missing).toContain("circularLayerDependencies");
  });

  test("evaluates session floor as failed when a count is below threshold", () => {
    const result = evaluateSessionFloor({
      rawPromisesRemoved: 1,
      servicesMigratedToTagLayer: 2,
      domainPurityViolationsResolved: 1,
      rawErrorsConvertedToTyped: 1,
      eventEmittersConvertedToStreams: 0,
      circularLayerDependencies: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.below).toContain("rawPromisesRemoved");
  });

  test("deriveSessionCountsFromSnapshots maps snapshot deltas to session floor counts", async () => {
    const older = await buildEffectGatesReport({ projectRoot: tmpDir, tool: "test" });
    await writeFile(
      join(tmpDir, "src", "leaky.ts"),
      `export function leaky() { return fetch("/x").then((r) => r.json()); }`
    );
    const newer = await buildEffectGatesReport({ projectRoot: tmpDir, tool: "test" });

    const counts = deriveSessionCountsFromSnapshots([newer, older]);
    expect(counts).not.toBeNull();
    expect(counts!.rawPromisesRemoved).toBeGreaterThanOrEqual(0);
    expect(counts!.circularLayerDependencies).toBe(newer.counts.layerCircularity);
  });

  test("persists and reads snapshots", async () => {
    const report = await buildEffectGatesReport({ projectRoot: tmpDir, tool: "test" });
    await appendEffectGatesSnapshot(tmpDir, report);
    const snapshots = await readEffectGatesSnapshots(tmpDir);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].tool).toBe("test");
    expect(snapshots[0].schemaVersion).toBe(EFFECT_GATES_REPORT_SCHEMA_VERSION);
  });

  test("detects regressions between snapshots", () => {
    const previous = {
      schemaVersion: EFFECT_GATES_REPORT_SCHEMA_VERSION,
      tool: "test",
      generatedAt: new Date().toISOString(),
      project: "test",
      thresholds: {
        maxDirectPromise: 0,
        layerCircularityTolerance: 0,
        serviceTagRequired: true,
        domainPurityLevel: "strict" as const,
        runPromiseBoundaryEnabled: true,
        eventStreamsEnabled: false,
      },
      counts: {
        directPromise: 1,
        layerCircularity: 0,
        missingServiceTag: 0,
        domainPurity: 0,
        runPromiseBoundary: 0,
        eventStream: 0,
      },
      summary: { total: 1, errors: 1, warnings: 0 },
      violations: [],
    };

    const current = {
      ...previous,
      counts: {
        directPromise: 3,
        layerCircularity: 0,
        missingServiceTag: 0,
        domainPurity: 0,
        runPromiseBoundary: 0,
        eventStream: 0,
      },
    };

    const regressions = detectRegressions(current, previous);
    expect(regressions).toHaveLength(1);
    expect(regressions[0].message).toContain("direct-promise");
    expect(regressions[0].message).toContain("1 to 3");
  });

  test("no regressions when counts are stable or improved", () => {
    const previous = {
      schemaVersion: EFFECT_GATES_REPORT_SCHEMA_VERSION,
      tool: "test",
      generatedAt: new Date().toISOString(),
      project: "test",
      thresholds: {
        maxDirectPromise: 0,
        layerCircularityTolerance: 0,
        serviceTagRequired: true,
        domainPurityLevel: "strict" as const,
        runPromiseBoundaryEnabled: true,
        eventStreamsEnabled: false,
      },
      counts: {
        directPromise: 2,
        layerCircularity: 0,
        missingServiceTag: 0,
        domainPurity: 0,
        runPromiseBoundary: 0,
        eventStream: 0,
      },
      summary: { total: 2, errors: 2, warnings: 0 },
      violations: [],
    };

    const current = {
      ...previous,
      counts: {
        directPromise: 1,
        layerCircularity: 0,
        missingServiceTag: 0,
        domainPurity: 0,
        runPromiseBoundary: 0,
        eventStream: 0,
      },
    };

    expect(detectRegressions(current, previous)).toHaveLength(0);
  });

  test("report includes thresholds loaded from constants", async () => {
    const report = await buildEffectGatesReport({ projectRoot: tmpDir, tool: "test" });
    expect(report.thresholds.maxDirectPromise).toBe(KIMI_EFFECT_MAX_DIRECT_PROMISE);
    expect(report.thresholds.layerCircularityTolerance).toBe(KIMI_LAYER_CIRCULARITY_TOLERANCE);
    expect(report.thresholds.serviceTagRequired).toBe(KIMI_SERVICE_TAG_REQUIRED);
    expect(report.thresholds.domainPurityLevel).toBe(KIMI_DOMAIN_PURITY_LEVEL);
    expect(report.thresholds.runPromiseBoundaryEnabled).toBe(
      KIMI_EFFECT_RUN_PROMISE_BOUNDARY_ENABLED
    );
    expect(report.thresholds.eventStreamsEnabled).toBe(false);
  });
});
