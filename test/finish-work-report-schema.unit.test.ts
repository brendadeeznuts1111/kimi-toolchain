import { describe, expect, test } from "bun:test";
import {
  FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION,
  gateStatusFromPublicEntry,
  isFinishWorkPublicGateEntry,
  validateFinishWorkReportV11,
} from "../src/lib/finish-work-report-schema.ts";

describe("finish-work-report-schema", () => {
  test("validateFinishWorkReportV11 accepts v1.1 shape", () => {
    const result = validateFinishWorkReportV11({
      schemaVersion: FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION,
      timestamp: "2026-06-17T02:37:00.000Z",
      agent: "kimi",
      paneId: "wB:p6F",
      durationMs: 1200,
      git: { committed: true, pushed: true, hash: "d6bc96d", branch: "main" },
      tree: { clean: true, dirtyFiles: [], untracked: 0 },
      gates: {
        "check:fast": { status: "pass", durationMs: 4200 },
        "effect-gates": { status: "pass", durationMs: 8700, healAuditTriggered: true },
      },
      outcome: "clean",
      outcomeReason: "All gates passed + clean tree after push",
      review: { escalated: false, reviewerPane: null, reportPath: ".kimi/finish-work-report.json" },
      latm: {
        markerSeen: true,
        completionSignal: "__LATM_DONE__",
        invokedVia: "finish-work --push",
      },
      handoffCandidate: {
        targetPane: "wB:p6G",
        targetAgent: "codex-primary",
        reason: "clean finish-work close",
        shouldHandoff: true,
      },
      summary: "feat: test — gates passed, pushed d6bc96d, tree clean.",
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.report?.handoffCandidate?.targetAgent).toBe("codex-primary");
  });

  test("validateFinishWorkReportV11 rejects wrong schema version", () => {
    const result = validateFinishWorkReportV11({
      schemaVersion: "1.0",
      timestamp: "2026-06-17T02:37:00.000Z",
      git: { committed: true, pushed: false },
      tree: { clean: true },
      outcome: "clean",
      outcomeReason: "x",
      summary: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((line) => line.includes("schemaVersion"))).toBe(true);
  });

  test("isFinishWorkPublicGateEntry and gateStatusFromPublicEntry", () => {
    const entry = { status: "pass" as const, durationMs: 12, doctorPane: "wB:p6E" };
    expect(isFinishWorkPublicGateEntry(entry)).toBe(true);
    expect(gateStatusFromPublicEntry(entry)).toBe("pass");
    expect(gateStatusFromPublicEntry("fail")).toBe("fail");
  });
});
