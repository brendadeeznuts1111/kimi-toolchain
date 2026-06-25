import { makeDir, writeText } from "../src/lib/bun-io.ts";

import { join } from "path";
import { describe, expect, test } from "bun:test";
import { testTempDir } from "./helpers.ts";
import {
  buildContextSyncFromReport,
  enrichHandoffMessage,
  formatFinishWorkBrief,
  isFinishWorkHandoffCondition,
} from "../src/lib/finish-work-herdr.ts";
import { FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION } from "../src/lib/finish-work-report-schema.ts";

function writeV11Report(root: string): void {
  makeDir(join(root, ".kimi"), { recursive: true });
  writeText(
    join(root, ".kimi", "finish-work-report.json"),
    JSON.stringify(
      {
        schemaVersion: FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION,
        timestamp: "2026-06-17T02:37:00.000Z",
        agent: "kimi",
        paneId: "wB:p6F",
        git: { committed: true, pushed: true, hash: "d6bc96d", branch: "main" },
        tree: { clean: true, dirtyFiles: [], untracked: 0 },
        gates: {
          "check:fast": { status: "pass", durationMs: 4200 },
          "effect-gates": { status: "pass", durationMs: 8700, healAuditTriggered: true },
          "heal-audit": { status: "pass", durationMs: 3100, doctorPane: "wB:p6E" },
        },
        outcome: "clean",
        outcomeReason: "All gates passed + clean tree after push",
        review: {
          escalated: false,
          reviewerPane: null,
          reportPath: ".kimi/finish-work-report.json",
        },
        latm: {
          markerSeen: true,
          completionSignal: "__LATM_DONE__",
          invokedVia: 'finish-work --message "feat: profile validation" --push',
        },
        handoffCandidate: {
          targetPane: "wB:p6G",
          targetAgent: "codex-primary",
          reason: "clean finish-work close",
          shouldHandoff: true,
        },
        summary:
          "feat: add user profile validation — gates passed, pushed d6bc96d, tree clean. Ready for codex handoff.",
      },
      null,
      2
    )
  );
}

describe("context-sync-from-report", () => {
  test("isFinishWorkHandoffCondition matches finish-work probe rules", () => {
    expect(isFinishWorkHandoffCondition("finish-work:clean")).toBe(true);
    expect(isFinishWorkHandoffCondition("finish-work:handoff-ready")).toBe(true);
    expect(isFinishWorkHandoffCondition("probe:finish-work:pushed")).toBe(true);
    expect(isFinishWorkHandoffCondition("done")).toBe(false);
  });

  test("buildContextSyncFromReport reads v1.1 report", () => {
    const root = testTempDir("ctx-sync-");
    writeV11Report(root);

    const payload = buildContextSyncFromReport(root);
    expect(payload).not.toBeNull();
    expect(payload?.summary).toContain("profile validation");
    expect(payload?.outcome).toBe("clean");
    expect(payload?.lastCommit).toBe("d6bc96d");
    expect(payload?.gatesSummary).toContain("check:fast:pass");
    expect(payload?.handoffCandidate?.targetAgent).toBe("codex-primary");
  });

  test("enrichHandoffMessage appends report brief block", () => {
    const root = testTempDir("ctx-enrich-");
    writeV11Report(root);
    const payload = buildContextSyncFromReport(root);

    const enriched = enrichHandoffMessage("Handoff from kimi after clean finish-work.", payload);

    expect(enriched).toContain("Handoff from kimi after clean finish-work.");
    expect(enriched).toContain("=== Latest finish-work report ===");
    expect(enriched).toContain("profile validation");
    expect(enriched).toContain("Outcome: clean | Gates:");
    expect(enriched).toContain("Last commit: d6bc96d");
    expect(enriched).toContain("Handoff target: codex-primary (wB:p6G)");
    expect(enriched).toContain("=== End report ===");
  });

  test("enrichHandoffMessage returns base when payload is null", () => {
    expect(enrichHandoffMessage("base only", null)).toBe("base only");
  });

  test("enrichHandoffMessage includes review notes when present", () => {
    const root = testTempDir("ctx-review-");
    makeDir(join(root, ".kimi"), { recursive: true });
    writeText(
      join(root, ".kimi", "finish-work-report.json"),
      JSON.stringify(
        {
          schemaVersion: FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION,
          timestamp: "2026-06-17T02:37:00.000Z",
          git: { committed: true, pushed: true, hash: "d6bc96d" },
          tree: { clean: true, dirtyFiles: [], untracked: 0 },
          gates: { "check:fast": { status: "pass", durationMs: 1 } },
          outcome: "clean",
          outcomeReason: "ok",
          summary: "feat: test — clean close",
          review: {
            escalated: false,
            reviewerPane: "wB:p99",
            reportPath: ".kimi/finish-work-report.json",
            feedback: "Post-push review complete — tree clean",
            lastFeedbackAt: "2026-06-17T03:00:00.000Z",
            resolved: true,
          },
          latm: { markerSeen: true, completionSignal: "__LATM_DONE__", invokedVia: "finish-work" },
          handoffCandidate: null,
        },
        null,
        2
      )
    );

    const payload = buildContextSyncFromReport(root);
    const enriched = enrichHandoffMessage("handoff base", payload);
    expect(enriched).toContain("=== Review notes ===");
    expect(enriched).toContain("Post-push review complete — tree clean");
    expect(enriched).toContain("Resolved: yes");
    expect(enriched).toContain("Reviewer pane: wB:p99");
  });

  test("formatFinishWorkBrief omits empty base prefix", () => {
    const root = testTempDir("ctx-brief-");
    writeV11Report(root);
    const payload = buildContextSyncFromReport(root);
    const brief = formatFinishWorkBrief(payload!);
    expect(brief.startsWith("=== Latest finish-work report ===")).toBe(true);
  });
});
