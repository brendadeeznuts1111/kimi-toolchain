import { makeDir, removePath } from "../src/lib/bun-io.ts";

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { Effect } from "effect";
import { testTempDir } from "./helpers.ts";
import {
  applyLifecycleProposal,
  buildConfigTimeline,
  createAbProposalEffect,
  createCanaryProposalEffect,
  rollbackLifecycleChange,
  validateConfigConstants,
  validateProposedValue,
  watchLifecycleProposal,
} from "../src/lib/config-lifecycle.ts";
import { logDecision } from "../src/lib/decision-ledger.ts";

const BUNFIG = `[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.1.0"'
`;

const TYPES = `/**
 * @defineDomain hook-verifier
 * @type number
 * @default 32
 * @restrictions positive integer — max allowed hook-graph cycle length
 */
declare const KIMI_HOOK_VERIFIER_MAX_CYCLES: number;

/**
 * @defineDomain governance
 * @type string
 * @default "1.1.0"
 * @restrictions semver — bump when any other KIMI_* define is added, changed, or removed
 */
declare const KIMI_TUNING_SET_VERSION: string;
`;

describe("config-lifecycle", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = testTempDir("config-lifecycle-");
    makeDir(join(projectRoot, "types"), { recursive: true });
    makeDir(join(projectRoot, ".kimi", "var"), { recursive: true });
    await Bun.write(join(projectRoot, ".kimi", "decisions.ndjson"), "");
    await Bun.write(join(projectRoot, "bunfig.toml"), BUNFIG);
    await Bun.write(join(projectRoot, "types", "build-constants.d.ts"), TYPES);
  });

  afterEach(() => {
    removePath(projectRoot, { recursive: true, force: true });
  });

  test("validates current constants against build-constants types", async () => {
    const report = await validateConfigConstants(projectRoot);
    expect(report.summary.ok).toBe(true);
    expect(report.constants.map((item) => item.key)).toContain("KIMI_HOOK_VERIFIER_MAX_CYCLES");
  });

  test("rejects invalid proposed values by schema restrictions", async () => {
    const issues = await validateProposedValue(projectRoot, "KIMI_HOOK_VERIFIER_MAX_CYCLES", 0);
    expect(issues.some((item) => item.severity === "error")).toBe(true);
  });

  test("canary writes proposal without mutating bunfig", async () => {
    const before = await Bun.file(join(projectRoot, "bunfig.toml")).text();
    const result = await Effect.runPromise(
      createCanaryProposalEffect({
        projectRoot,
        constant: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
        value: 64,
        percent: 10,
      })
    );
    const after = await Bun.file(join(projectRoot, "bunfig.toml")).text();
    expect(result.record.status).toBe("passed");
    expect(after).toBe(before);
    expect(
      await Bun.file(join(projectRoot, ".kimi", "var", "config-lifecycle.ndjson")).text()
    ).toContain(result.record.id);
  });

  test("A/B proposal compares variants deterministically", async () => {
    const result = await Effect.runPromise(
      createAbProposalEffect({
        projectRoot,
        constant: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
        a: 32,
        b: 0,
        duration: "1h",
      })
    );
    expect(result.record.status).toBe("failed");
    expect(result.variants.find((item) => item.name === "a")?.passed).toBe(true);
    expect(result.variants.find((item) => item.name === "b")?.passed).toBe(false);
  });

  test("timeline includes lifecycle and decision events", async () => {
    const proposal = await Effect.runPromise(
      createCanaryProposalEffect({
        projectRoot,
        constant: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
        value: 64,
        percent: 10,
      })
    );
    const decision = await logDecision(
      {
        action: "config-change",
        trigger: { traceId: "trace-test" },
        metadata: {
          type: "constant-repair",
          constantKey: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
        },
        rationaleOverride: {
          summary: "repair test",
          fullReasoning: "repair test",
        },
      },
      { projectRoot }
    );
    const timeline = await buildConfigTimeline(projectRoot, "KIMI_HOOK_VERIFIER_MAX_CYCLES");
    expect(timeline.events.map((item) => item.id)).toContain(proposal.record.id);
    expect(timeline.events.map((item) => item.id)).toContain(decision.decisionId);
  });

  test("apply and rollback mutate only the targeted define", async () => {
    const proposal = await Effect.runPromise(
      createCanaryProposalEffect({
        projectRoot,
        constant: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
        value: 64,
        percent: 10,
      })
    );
    const apply = await applyLifecycleProposal({
      projectRoot,
      proposalId: proposal.record.id,
    });
    expect(await Bun.file(join(projectRoot, "bunfig.toml")).text()).toContain(
      'KIMI_HOOK_VERIFIER_MAX_CYCLES = "64"'
    );
    await rollbackLifecycleChange({ projectRoot, id: apply.id });
    const restored = await Bun.file(join(projectRoot, "bunfig.toml")).text();
    expect(restored).toContain('KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"');
    expect(restored).toContain(`KIMI_TUNING_SET_VERSION = '"1.1.0"'`);
  });

  test("watch recommends rollback when health score drops over threshold", async () => {
    const proposal = await Effect.runPromise(
      createCanaryProposalEffect({
        projectRoot,
        constant: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
        value: 64,
        percent: 10,
      })
    );
    const apply = await applyLifecycleProposal({
      projectRoot,
      proposalId: proposal.record.id,
    });
    await Bun.write(
      join(projectRoot, ".kimi", "var", "health.ndjson"),
      [
        JSON.stringify({ timestamp: "2026-06-15T00:00:00.000Z", score: 95 }),
        JSON.stringify({ timestamp: "2099-01-01T00:00:00.000Z", score: 70 }),
        "",
      ].join("\n")
    );
    const report = await watchLifecycleProposal({
      projectRoot,
      proposalId: apply.id,
      threshold: 15,
      dryRun: true,
    });
    expect(report.status).toBe("rollback-recommended");
    expect(report.rollbackCommand).toContain("kimi-config rollback");
  });
});
