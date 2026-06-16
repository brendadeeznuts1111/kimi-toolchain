import { describe, expect, test } from "bun:test";
import { fingerprintDoctorWatch, formatDoctorWatchChange } from "../src/lib/doctor-watch.ts";
import type { EffectGatesReport } from "../src/lib/effect-gates.ts";

function sampleReport(overrides: Partial<EffectGatesReport["counts"]> = {}): EffectGatesReport {
  return {
    schemaVersion: 1,
    tool: "kimi-doctor",
    generatedAt: "2026-06-16T00:00:00.000Z",
    project: "demo",
    thresholds: {
      maxDirectPromise: 0,
      layerCircularityTolerance: 0,
      serviceTagRequired: true,
      domainPurityLevel: "strict",
      runPromiseBoundaryEnabled: true,
      eventStreamsEnabled: false,
    },
    counts: {
      directPromise: 0,
      layerCircularity: 0,
      missingServiceTag: 0,
      domainPurity: 0,
      runPromiseBoundary: 0,
      eventStream: 0,
      ...overrides,
    },
    summary: { total: 0, errors: 0, warnings: 0 },
    violations: [],
  };
}

describe("doctor-watch", () => {
  test("fingerprintDoctorWatch changes when error count changes", () => {
    const clean = fingerprintDoctorWatch(sampleReport(), 0);
    const dirty = fingerprintDoctorWatch(
      {
        ...sampleReport(),
        summary: { total: 1, errors: 1, warnings: 0 },
        violations: [
          {
            gate: "direct-promise",
            severity: "error",
            message: "bare promise",
            location: "src/a.ts:1",
          },
        ],
      },
      0
    );
    expect(clean).not.toBe(dirty);
  });

  test("formatDoctorWatchChange includes regression lines", () => {
    const lines = formatDoctorWatchChange(sampleReport(), ["count increased"]);
    expect(lines[0]).toContain("0 violation(s)");
    expect(lines.some((line) => line.includes("regression"))).toBe(true);
  });
});
