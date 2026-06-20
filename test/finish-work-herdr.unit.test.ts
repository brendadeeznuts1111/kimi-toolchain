import { makeDir, readText, writeText } from "../src/lib/bun-io.ts";

import { join } from "path";
import { describe, expect, test } from "bun:test";
import { testTempDir, withEnv } from "./helpers.ts";
import {
  finishWorkLocalGatesForced,
  finishWorkOutcome,
  isPaneBlockedForReview,
  resolveDoctorPaneId,
  resolveTabPrimaryPane,
  runDoctorPaneGate,
  spawnGateCommandToLog,
  shouldEscalateToReviewer,
  shouldRouteGateThroughDoctor,
  shouldRunGateInDoctorPane,
  shouldSkipFinishWorkFollowUp,
  appendReviewerFeedback,
  buildFinishWorkOutcomeReason,
  buildFinishWorkSummary,
  evaluateFinishWorkProbeCondition,
  finishWorkGateKey,
  finishWorkOutcomeLabel,
  loadFinishWorkReport,
  normalizeFinishWorkReport,
  persistFinishWorkReport,
  type FinishWorkHerdrDeps,
  type FinishWorkReport,
} from "../src/lib/finish-work-herdr.ts";
import { gitRevParse } from "../src/lib/git-helpers.ts";

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
    withEnv({ HERDR_ENV: "1", KIMI_FINISH_WORK_LOCAL_GATES: undefined }, () => {
      expect(shouldRunGateInDoctorPane("kimi-heal effect audit")).toBe(true);

      withEnv({ KIMI_FINISH_WORK_LOCAL_GATES: "1" }, () => {
        expect(shouldRunGateInDoctorPane("kimi-heal effect audit")).toBe(false);
      });

      withEnv({ HERDR_ENV: undefined }, () => {
        expect(shouldRunGateInDoctorPane("kimi-heal effect audit")).toBe(false);
      });
    });
  });

  test("finishWorkLocalGatesForced accepts true", () => {
    withEnv({ KIMI_FINISH_WORK_LOCAL_GATES: "true" }, () => {
      expect(finishWorkLocalGatesForced()).toBe(true);
    });
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
    await withEnv({ HERDR_DOCTOR_PANE_ID: "w9:p9" }, async () => {
      const resolved = await resolveDoctorPaneId("/tmp/unused", {
        herdrCliJson: async () => {
          throw new Error("should not call herdr");
        },
      });
      expect(resolved).toEqual({ paneId: "w9:p9", doctorTab: "doctor" });
    });
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

  test("spawnGateCommandToLog merges stdout and stderr into log file", async () => {
    const root = testTempDir("finish-work-gate-spawn-");
    const logPath = join(root, ".kimi", "gate.log");
    const code = await spawnGateCommandToLog("printf out\\n; printf err >&2", logPath, {
      cwd: root,
    });
    expect(code).toBe(0);
    const log = await Bun.file(logPath).text();
    expect(log).toContain("out");
    expect(log).toContain("err");
  });

  test("runDoctorPaneGate returns command exit code from doctor pane marker", async () => {
    const root = testTempDir("finish-work-herdr-");
    makeDir(join(root, ".kimi"), { recursive: true });
    const logPath = join(root, ".kimi", "finish-work-gate-kimi-heal.log");
    writeText(logPath, "audit ok\n");

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

    await withEnv({ HERDR_DOCTOR_PANE_ID: "w1:p7" }, async () => {
      const result = await runDoctorPaneGate(root, "kimi-heal", "kimi-heal effect audit", deps);
      expect(result.exitCode).toBe(0);
      expect(result.routed).toBe(true);
      expect(result.doctorPaneId).toBe("w1:p7");
      expect(result.stdout).toContain("audit ok");
      expect(capturedRun).toContain("kimi-heal effect audit");
      expect(capturedRun).toContain("finish-work-gate-run.ts");
      expect(capturedRun).not.toContain("2>&1");
    });
  });

  test("evaluateFinishWorkProbeCondition passes finish-work:pushed on clean close", async () => {
    const root = testTempDir("fw-probe-");
    makeDir(join(root, ".kimi"), { recursive: true });
    await persistFinishWorkReport(
      root,
      baseReport({ gitHead: "abc123", completedAt: new Date().toISOString() })
    );

    const result = await evaluateFinishWorkProbeCondition("finish-work:pushed", root);
    expect(result.ok).toBe(true);
  });

  test("finishWorkGateKey maps toolchain gates to stable names", () => {
    expect(finishWorkGateKey("bun run check:fast")).toBe("check:fast");
    expect(finishWorkGateKey("kimi-doctor --effect-gates")).toBe("effect-gates");
    expect(finishWorkGateKey("kimi-doctor --dashboard-automation")).toBe("dashboard-automation");
    expect(finishWorkGateKey("kimi-doctor --dashboard-meta")).toBe("dashboard-meta");
    expect(finishWorkGateKey("kimi-heal effect audit")).toBe("heal-audit");
  });

  test("serializeFinishWorkReport matches public JSON contract", async () => {
    const root = testTempDir("fw-serialize-");
    makeDir(join(root, ".kimi"), { recursive: true });
    await persistFinishWorkReport(
      root,
      baseReport({
        paneId: "wB:p6F",
        agent: "kimi",
        results: [
          { name: "check:fast", exitCode: 0, ms: 1 },
          { name: "effect-gates", exitCode: 0, ms: 2 },
          { name: "heal-audit", exitCode: 0, ms: 3 },
        ],
        gitHead: "d6bc96d1234567890abcdef1234567890abcd",
      })
    );

    const raw = JSON.parse(readText(join(root, ".kimi", "finish-work-report.json"))) as Record<
      string,
      unknown
    >;
    expect(raw.schemaVersion).toBe("1.1");
    expect(raw.timestamp).toBeTypeOf("string");
    expect(raw.agent).toBe("kimi");
    expect(raw.paneId).toBe("wB:p6F");
    expect(raw.outcome).toBe("clean");
    expect(raw.outcomeReason).toBeTypeOf("string");
    expect(raw.summary).toBeTypeOf("string");
    expect((raw.git as { hash?: string }).hash).toBe("d6bc96d");
    expect((raw.gates as Record<string, { status?: string }>)["check:fast"]?.status).toBe("pass");
    expect((raw.latm as { completionSignal?: string })?.completionSignal).toBe("__LATM_DONE__");
    expect((raw.review as { reportPath?: string })?.reportPath).toContain(
      "finish-work-report.json"
    );

    const loaded = await loadFinishWorkReport(root);
    expect(loaded?.outcome).toBe("ok");
    expect(loaded?.outcomeLabel).toBe("clean");
    expect(loaded?.git.head).toBe("d6bc96d1234567890abcdef1234567890abcd");
  });

  test("normalizeFinishWorkReport reads public outcome labels", () => {
    const normalized = normalizeFinishWorkReport({
      schemaVersion: 1,
      tool: "finish-work",
      timestamp: "2026-06-17T02:37:00.000Z",
      agent: "kimi",
      paneId: "wB:p6F",
      ok: true,
      git: { attempted: true, committed: true, pushed: true, error: null, hash: "d6bc96d" },
      tree: { clean: true, dirty: [] },
      gates: { "check:fast": "pass" },
      outcome: "clean",
      gateSource: "finishWork",
      results: [],
    });
    expect(normalized.outcome).toBe("ok");
    expect(normalized.outcomeLabel).toBe("clean");
    expect(normalized.completedAt).toBe("2026-06-17T02:37:00.000Z");
  });

  test("finishWorkOutcomeLabel maps close outcomes", () => {
    expect(finishWorkOutcomeLabel(baseReport())).toBe("clean");
    expect(
      finishWorkOutcomeLabel(
        baseReport({ outcome: "escalated", tree: { clean: false, dirty: ["?? x.md"] } })
      )
    ).toBe("escalated");
    expect(finishWorkOutcomeLabel(baseReport({ ok: false, outcome: "failed" }))).toBe("aborted");
  });

  test("evaluateFinishWorkProbeCondition supports finish-work:clean and dirty", async () => {
    const root = testTempDir("fw-probe-outcome-");
    makeDir(join(root, ".kimi"), { recursive: true });
    await persistFinishWorkReport(root, baseReport({ gitHead: "abc1234" }));

    const clean = await evaluateFinishWorkProbeCondition("finish-work:clean", root);
    expect(clean.ok).toBe(true);

    await persistFinishWorkReport(
      root,
      baseReport({
        outcome: "escalated",
        tree: { clean: false, dirty: ["?? marker.md"] },
        gitHead: "abc1234",
      })
    );
    const dirty = await evaluateFinishWorkProbeCondition("finish-work:dirty", root);
    expect(dirty.ok).toBe(true);
    expect(dirty.message).toContain("escalated");
  });

  test("evaluateFinishWorkProbeCondition rejects stale gitHead", async () => {
    const root = import.meta.dir + "/..";
    const head = await gitRevParse(root, "HEAD");
    if (!head) return;

    const prior = await Bun.file(join(root, ".kimi", "finish-work-report.json"))
      .text()
      .catch(() => null);
    await persistFinishWorkReport(
      root,
      baseReport({ gitHead: "0000000000000000000000000000000000000000" })
    );
    const staleResult = await evaluateFinishWorkProbeCondition("finish-work:pushed", root);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.message).toContain("stale");
    if (prior) {
      await Bun.write(join(root, ".kimi", "finish-work-report.json"), prior);
    }
  });

  test("buildFinishWorkOutcomeReason and summary for clean close", () => {
    const report = baseReport({
      git: { attempted: true, committed: true, pushed: true, error: null },
      commitMessage: "feat: probe schema",
    });
    expect(buildFinishWorkOutcomeReason(report, "clean")).toContain("clean tree");
    expect(buildFinishWorkSummary(report, "clean")).toContain("feat: probe schema");
  });

  test("normalizeFinishWorkReport reads v1.1 rich gates and dirtyFiles", () => {
    const normalized = normalizeFinishWorkReport({
      schemaVersion: "1.1",
      timestamp: "2026-06-17T02:37:00.000Z",
      ok: true,
      git: { committed: true, pushed: true, error: null, hash: "abc" },
      tree: { clean: false, dirtyFiles: ["?? x.md"], untracked: 1 },
      gates: { "check:fast": { status: "pass", durationMs: 10 } },
      outcome: "dirty",
      gateSource: "finishWork",
      results: [],
      handoffCandidate: null,
    });
    expect(normalized.outcomeLabel).toBe("dirty");
    expect(normalized.tree.dirty).toEqual(["?? x.md"]);
    expect(normalized.gates?.["check:fast"]).toBe("pass");
  });

  test("appendReviewerFeedback writes review block", async () => {
    const root = testTempDir("fw-review-");
    makeDir(join(root, ".kimi"), { recursive: true });
    await persistFinishWorkReport(root, baseReport());

    const result = await appendReviewerFeedback(
      root,
      {
        message: "looks good",
        resolved: true,
        reviewerPane: "wB:p99",
      },
      { triggerContextSync: false, emitProcessedEvent: false }
    );

    const raw = JSON.parse(readText(join(root, ".kimi", "finish-work-report.json"))) as {
      review?: { feedback?: string; resolved?: boolean; lastFeedbackAt?: string };
    };
    expect(raw.review?.feedback).toBe("looks good");
    expect(raw.review?.resolved).toBe(true);
    expect(raw.review?.lastFeedbackAt).toBeTypeOf("string");
    expect(result.payload?.reviewNotes?.feedback).toBe("looks good");
  });

  test("evaluateFinishWorkProbeCondition supports finish-work:handoff-ready", async () => {
    const root = testTempDir("fw-handoff-");
    makeDir(join(root, ".kimi"), { recursive: true });
    await persistFinishWorkReport(
      root,
      baseReport({
        handoffCandidate: {
          targetPane: "wB:p6G",
          targetAgent: "codex-primary",
          reason: "clean finish-work close",
          shouldHandoff: true,
        },
      })
    );

    const ready = await evaluateFinishWorkProbeCondition("finish-work:handoff-ready", root);
    expect(ready.ok).toBe(true);
    expect(ready.message).toContain("codex-primary");
  });

  test("evaluateFinishWorkProbeCondition blocks escalated outcome", async () => {
    const root = testTempDir("fw-probe-esc-");
    makeDir(join(root, ".kimi"), { recursive: true });
    const head = (await gitRevParse(import.meta.dir + "/..", "HEAD")) ?? "deadbeef";
    await persistFinishWorkReport(
      root,
      baseReport({
        outcome: "escalated",
        tree: { clean: false, dirty: ["?? marker.md"] },
        gitHead: head,
      })
    );

    const result = await evaluateFinishWorkProbeCondition("finish-work:pushed", root);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("escalated");
  });
});
