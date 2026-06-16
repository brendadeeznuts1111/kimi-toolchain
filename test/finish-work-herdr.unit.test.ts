import { describe, expect, test } from "bun:test";
import {
  finishWorkOutcome,
  isPaneBlockedForReview,
  shouldEscalateToReviewer,
  type FinishWorkReport,
} from "../src/lib/finish-work-herdr.ts";

function baseReport(overrides: Partial<FinishWorkReport> = {}): FinishWorkReport {
  return {
    schemaVersion: 1,
    tool: "finish-work",
    ok: true,
    outcome: "ok",
    gateSource: "finishWork",
    results: [{ name: "check", exitCode: 0, ms: 1 }],
    git: { attempted: true, committed: true, pushed: true, error: null },
    tree: { clean: true, dirty: [] },
    ...overrides,
  };
}

describe("finish-work-herdr", () => {
  test("finishWorkOutcome escalates on dirty tree after push", () => {
    expect(finishWorkOutcome(true, true, false)).toBe("escalated");
    expect(finishWorkOutcome(true, true, true)).toBe("ok");
    expect(finishWorkOutcome(true, false, false)).toBe("ok");
    expect(finishWorkOutcome(false, true, false)).toBe("failed");
  });

  test("isPaneBlockedForReview matches finish-work escalation signal", () => {
    expect(
      isPaneBlockedForReview({
        agent: "finish-work",
        agent_status: "blocked",
        custom_status: "workspace.updated",
      })
    ).toBe(true);
    expect(isPaneBlockedForReview({ agent_status: "blocked", custom_status: "needs-review" })).toBe(
      true
    );
    expect(
      isPaneBlockedForReview({ agent_status: "blocked", custom_status: "workspace.updated" })
    ).toBe(false);
    expect(isPaneBlockedForReview({ agent_status: "idle", custom_status: "needs-review" })).toBe(
      false
    );
  });

  test("shouldEscalateToReviewer requires push and dirty tree", () => {
    expect(shouldEscalateToReviewer(baseReport({ tree: { clean: false, dirty: [" M a"] } }))).toBe(
      true
    );
    expect(shouldEscalateToReviewer(baseReport())).toBe(false);
    expect(
      shouldEscalateToReviewer(
        baseReport({
          git: { attempted: true, committed: true, pushed: false, error: null },
          tree: { clean: false, dirty: [" M a"] },
        })
      )
    ).toBe(false);
  });
});
