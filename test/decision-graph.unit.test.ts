import { describe, expect, test } from "bun:test";
import { createDecisionRecord } from "../src/lib/decision-ledger.ts";
import { buildDecisionGraph, renderDecisionGraphAscii } from "../src/lib/decision-graph.ts";

describe("decision-graph", () => {
  test("builds DAG from parentDecisionId links", async () => {
    const root = createDecisionRecord({
      decisionId: "decision-root",
      key: "incident-graph",
      action: "detect incident",
      trigger: "alert fired",
      rationale: "Start incident flow.",
      outcome: "unknown",
      traceId: "trace-graph",
    });
    const rollback = createDecisionRecord({
      decisionId: "decision-rollback",
      key: "incident-graph",
      action: "rollback release",
      trigger: "error spike",
      rationale: "Undo bad deployment.",
      outcome: "success",
      parentDecisionId: root.decisionId,
      traceId: "trace-graph",
    });
    const fix = createDecisionRecord({
      decisionId: "decision-fix",
      key: "incident-graph",
      action: "apply follow-up fix",
      trigger: "stability check",
      rationale: "Prevent reoccurrence.",
      outcome: "success",
      parentDecisionId: rollback.decisionId,
      traceId: "trace-graph",
    });

    const graph = await buildDecisionGraph(root.decisionId, [root, rollback, fix]);

    expect(graph.found).toBe(true);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.rootDecisionIds).toContain(root.decisionId);
    expect(
      graph.edges.some((edge) => edge.from === root.decisionId && edge.to === rollback.decisionId)
    ).toBe(true);
    expect(
      graph.edges.some((edge) => edge.from === rollback.decisionId && edge.to === fix.decisionId)
    ).toBe(true);
  });

  test("renders ascii graph with root and children", async () => {
    const root = createDecisionRecord({
      decisionId: "decision-root-render",
      key: "incident-render",
      action: "identify root cause",
      trigger: "graph rendering",
      rationale: "Prepare output.",
      outcome: "unknown",
      traceId: "trace-render",
    });
    const child = createDecisionRecord({
      decisionId: "decision-child-render",
      key: "incident-render",
      action: "rollback",
      trigger: "render child",
      rationale: "Recover quickly.",
      outcome: "success",
      parentDecisionId: root.decisionId,
      traceId: "trace-render",
    });

    const graph = await buildDecisionGraph(root.decisionId, [root, child]);
    const ascii = renderDecisionGraphAscii(graph);

    expect(ascii).toContain("decision graph for");
    expect(ascii).toContain(root.decisionId);
    expect(ascii).toContain(child.decisionId);
    expect(ascii).toContain("rollback");
  });
});
