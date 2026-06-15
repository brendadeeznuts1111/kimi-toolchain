import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  generateRationale,
  logDecision,
  readDecisions,
  buildDecisionGraph,
  suggestDecisions,
  findDecisionById,
  updateDecisionOutcome,
  type DecisionInput,
} from "../src/lib/decision-ledger.ts";
import { decisionsNdjsonPath } from "../src/lib/paths.ts";

describe("decision-ledger", () => {
  let tmpRoot: string;
  let decisionsPath: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `kimi-decision-${Bun.randomUUIDv7()}`);
    mkdirSync(join(tmpRoot, ".kimi"), { recursive: true });
    decisionsPath = decisionsNdjsonPath(tmpRoot);
    Bun.env.KIMI_TRACE_ID = "trace-ledger-test";
  });

  afterEach(() => {
    delete Bun.env.KIMI_TRACE_ID;
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("generateRationale builds heal playbook text from cluster context", async () => {
    const input: DecisionInput = {
      action: "heal",
      trigger: { traceId: "trace-abc", clusterId: "cluster-lock-01", errorId: "err-1" },
    };
    const rationale = await generateRationale(input, {
      projectRoot: tmpRoot,
      playbookId: "regenerate-bun-lockfile",
      clusterCount: 3,
      priorSuccessDecisionIds: ["dec-prior-45", "dec-prior-72"],
    });

    expect(rationale.summary).toContain("regenerate-bun-lockfile");
    expect(rationale.fullReasoning).toContain("cluster-lock-01");
    expect(rationale.fullReasoning).toContain("dec-prior-45");
    expect(rationale.evidence.some((e) => e.type === "cluster")).toBe(true);
  });

  test("logDecision appends v2 record to .kimi/decisions.ndjson", async () => {
    const decision = await logDecision(
      {
        action: "contract-sign",
        trigger: { traceId: "trace-contract", contractFile: "typeserver" },
        metadata: { surface: "typeserver" },
        outcome: { result: "success", verifiedAt: new Date().toISOString() },
      },
      { projectRoot: tmpRoot }
    );

    expect(decision.schemaVersion).toBe(2);
    expect(decision.decisionId.startsWith("dec-")).toBe(true);
    expect(decision.rationale.summary).toContain("typeserver");

    const records = await readDecisions(tmpRoot);
    expect(records).toHaveLength(1);
    expect(records[0]?.decisionId).toBe(decision.decisionId);

    const file = await Bun.file(decisionsPath).text();
    expect(file.trim().split("\n")).toHaveLength(1);
  });

  test("buildDecisionGraph links parent and child decisions", async () => {
    const parent = await logDecision(
      {
        action: "heal",
        trigger: { traceId: "trace-graph-1", clusterId: "c1" },
        outcome: { result: "success" },
      },
      { projectRoot: tmpRoot }
    );
    await logDecision(
      {
        action: "config-change",
        trigger: { traceId: "trace-graph-1" },
        parentDecisionId: parent.decisionId,
        outcome: { result: "success" },
      },
      { projectRoot: tmpRoot }
    );

    const graph = buildDecisionGraph(await readDecisions(tmpRoot), "trace-graph-1");
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges).toEqual([{ from: parent.decisionId, to: expect.any(String) }]);
    expect(graph.roots.length).toBeGreaterThan(0);
  });

  test("updateDecisionOutcome mutates ndjson record", async () => {
    const decision = await logDecision(
      {
        action: "heal",
        trigger: { traceId: "trace-update", clusterId: "c-update" },
        outcome: { result: "pending" },
      },
      { projectRoot: tmpRoot }
    );

    const updated = await updateDecisionOutcome(
      decision.decisionId,
      {
        result: "success",
        verifiedAt: new Date().toISOString(),
        proof: { type: "cluster-dissolved", detail: "No recurrence" },
      },
      { projectRoot: tmpRoot, qualityScore: 0.95 }
    );

    expect(updated?.outcome.result).toBe("success");
    expect(updated?.qualityScore).toBe(0.95);

    const reloaded = await findDecisionById(decision.decisionId, tmpRoot);
    expect(reloaded?.outcome.proof?.type).toBe("cluster-dissolved");
  });

  test("suggestDecisions ranks by quality and confidence", async () => {
    await logDecision(
      {
        action: "heal",
        trigger: { traceId: "t1", clusterId: "cluster-x" },
        outcome: { result: "success" },
        metadata: { playbookId: "sync-runtime" },
      },
      { projectRoot: tmpRoot }
    );
    const high = await logDecision(
      {
        action: "heal",
        trigger: { traceId: "t2", clusterId: "cluster-x" },
        outcome: { result: "success" },
        metadata: { playbookId: "guardian-sign" },
      },
      { projectRoot: tmpRoot }
    );
    await updateDecisionOutcome(
      high.decisionId,
      { result: "success" },
      {
        projectRoot: tmpRoot,
        qualityScore: 0.95,
      }
    );

    const suggestions = await suggestDecisions({
      clusterId: "cluster-x",
      projectRoot: tmpRoot,
    });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.decisionId).toBe(high.decisionId);
    expect(suggestions[0]?.confidence).toBeGreaterThan(0.5);
  });
});
