import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import {
  finishWorkLocalGatesForced,
  finishWorkOutcome,
  isPaneBlockedForReview,
  resolveDoctorPaneId,
  resolveTabPrimaryPane,
  runDoctorPaneGate,
  shouldEscalateToReviewer,
  shouldRouteGateThroughDoctor,
  shouldRunGateInDoctorPane,
  shouldSkipFinishWorkFollowUp,
  type FinishWorkHerdrDeps,
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

  test("shouldSkipFinishWorkFollowUp skips effect-floor on dirty post-push tree", () => {
    expect(
      shouldSkipFinishWorkFollowUp({ skipGit: false, pushed: true, treeClean: false })
    ).toEqual({ skip: true, reason: "dirty tree escalated" });
    expect(shouldSkipFinishWorkFollowUp({ skipGit: false, pushed: true, treeClean: true })).toEqual(
      { skip: false }
    );
  });

  test("shouldRouteGateThroughDoctor matches kimi-heal effect audit only", () => {
    expect(shouldRouteGateThroughDoctor("kimi-heal effect audit")).toBe(true);
    expect(shouldRouteGateThroughDoctor("kimi-heal effect audit --json")).toBe(true);
    expect(shouldRouteGateThroughDoctor("kimi-doctor --effect-gates")).toBe(false);
    expect(shouldRouteGateThroughDoctor("bun run check:fast")).toBe(false);
  });

  test("shouldRunGateInDoctorPane requires HERDR_ENV and no local override", () => {
    const priorHerdr = process.env.HERDR_ENV;
    const priorLocal = process.env.KIMI_FINISH_WORK_LOCAL_GATES;
    try {
      process.env.HERDR_ENV = "1";
      delete process.env.KIMI_FINISH_WORK_LOCAL_GATES;
      expect(shouldRunGateInDoctorPane("kimi-heal effect audit")).toBe(true);

      process.env.KIMI_FINISH_WORK_LOCAL_GATES = "1";
      expect(shouldRunGateInDoctorPane("kimi-heal effect audit")).toBe(false);

      delete process.env.HERDR_ENV;
      expect(shouldRunGateInDoctorPane("kimi-heal effect audit")).toBe(false);
    } finally {
      if (priorHerdr === undefined) delete process.env.HERDR_ENV;
      else process.env.HERDR_ENV = priorHerdr;
      if (priorLocal === undefined) delete process.env.KIMI_FINISH_WORK_LOCAL_GATES;
      else process.env.KIMI_FINISH_WORK_LOCAL_GATES = priorLocal;
    }
  });

  test("finishWorkLocalGatesForced accepts true", () => {
    const prior = process.env.KIMI_FINISH_WORK_LOCAL_GATES;
    try {
      process.env.KIMI_FINISH_WORK_LOCAL_GATES = "true";
      expect(finishWorkLocalGatesForced()).toBe(true);
    } finally {
      if (prior === undefined) delete process.env.KIMI_FINISH_WORK_LOCAL_GATES;
      else process.env.KIMI_FINISH_WORK_LOCAL_GATES = prior;
    }
  });

  test("resolveTabPrimaryPane picks first pane in labeled tab", async () => {
    const calls: string[][] = [];
    const deps = {
      herdrCliJson: async (args: string[]) => {
        calls.push(args);
        if (args[0] === "tab") {
          return {
            ok: true,
            json: { result: { tabs: [{ tab_id: "w1:t9", label: "doctor" }] } },
            error: null,
            exitCode: 0,
          };
        }
        return {
          ok: true,
          json: {
            result: {
              panes: [
                { pane_id: "w1:p2", tab_id: "w1:t9" },
                { pane_id: "w1:p1", tab_id: "w1:t9" },
              ],
            },
          },
          error: null,
          exitCode: 0,
        };
      },
    };

    const resolved = await resolveTabPrimaryPane("w1", "doctor", deps as FinishWorkHerdrDeps);
    expect(resolved.paneId).toBe("w1:p1");
    expect(calls[0]).toEqual(["tab", "list", "--workspace", "w1"]);
  });

  test("resolveDoctorPaneId uses HERDR_DOCTOR_PANE_ID override", async () => {
    const prior = process.env.HERDR_DOCTOR_PANE_ID;
    try {
      process.env.HERDR_DOCTOR_PANE_ID = "w9:p9";
      const resolved = await resolveDoctorPaneId("/tmp/unused", {
        herdrCliJson: async () => {
          throw new Error("should not call herdr");
        },
      });
      expect(resolved).toEqual({ paneId: "w9:p9", doctorTab: "doctor" });
    } finally {
      if (prior === undefined) delete process.env.HERDR_DOCTOR_PANE_ID;
      else process.env.HERDR_DOCTOR_PANE_ID = prior;
    }
  });

  test("resolveTabPrimaryPane returns error when labeled tab is missing", async () => {
    const deps = {
      herdrCliJson: async () => ({
        ok: true,
        json: { result: { tabs: [{ tab_id: "w1:t1", label: "shell" }] } },
        error: null,
        exitCode: 0,
      }),
    };

    const resolved = await resolveTabPrimaryPane("w1", "doctor", deps as FinishWorkHerdrDeps);
    expect(resolved.paneId).toBeNull();
    expect(resolved.error).toContain("doctor tab not found");
  });

  test("runDoctorPaneGate returns command exit code from doctor pane marker", async () => {
    const root = join(tmpdir(), `finish-work-herdr-${Bun.randomUUIDv7()}`);
    mkdirSync(join(root, ".kimi"), { recursive: true });
    const logPath = join(root, ".kimi", "finish-work-gate-kimi-heal.log");
    writeFileSync(logPath, "audit ok\n");

    const prior = process.env.HERDR_DOCTOR_PANE_ID;
    process.env.HERDR_DOCTOR_PANE_ID = "w1:p7";

    let capturedRun = "";
    let gateNonce = "";
    const deps = {
      herdrCli: async (args: string[]) => {
        if (args[0] === "pane" && args[1] === "run") {
          capturedRun = args[3] ?? "";
          const nonceMatch = capturedRun.match(/__KIMI_FW_GATE_([a-f0-9]+):\$EC__/);
          gateNonce = nonceMatch?.[1] ?? "";
          return { ok: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (args[0] === "wait") {
          return {
            ok: true,
            stdout: `__KIMI_FW_GATE_${gateNonce}:0__`,
            stderr: "",
            exitCode: 0,
          };
        }
        return { ok: false, stdout: "", stderr: "unexpected", exitCode: 1 };
      },
    };

    try {
      const result = await runDoctorPaneGate(root, "kimi-heal", "kimi-heal effect audit", deps);
      expect(result.exitCode).toBe(0);
      expect(result.routed).toBe(true);
      expect(result.doctorPaneId).toBe("w1:p7");
      expect(result.stdout).toContain("audit ok");
      expect(capturedRun).toContain("kimi-heal effect audit");
    } finally {
      if (prior === undefined) delete process.env.HERDR_DOCTOR_PANE_ID;
      else process.env.HERDR_DOCTOR_PANE_ID = prior;
    }
  });
});
