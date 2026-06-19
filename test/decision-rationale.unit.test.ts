import { describe, expect, test } from "bun:test";
import { buildDecisionRationale } from "../src/lib/decision-rationale.ts";

describe("decision-rationale", () => {
  test("builds heal rationale with prior decision references", () => {
    const rationale = buildDecisionRationale({
      kind: "heal",
      playbookTitle: "regenerate-bun-lockfile",
      clusterId: "cluster-lockfile",
      clusterSize: 3,
      topTaxonomy: "lockfile_issue",
      traceId: "trace-abc123",
      priorSuccessCount: 2,
      priorDecisionIds: ["decision-45", "decision-72"],
    });

    expect(rationale.summary).toContain("regenerate-bun-lockfile");
    expect(rationale.fullReasoning).toContain("lockfile_issue");
    expect(rationale.fullReasoning).toContain("trace-abc123");
    expect(rationale.fullReasoning).toContain("decision-45");
    expect((rationale.evidence ?? []).some((item) => item.type === "cluster")).toBe(true);
    expect((rationale.evidence ?? []).some((item) => item.type === "playbook")).toBe(true);
  });

  test("builds contract rationale with drift hashes", () => {
    const rationale = buildDecisionRationale({
      kind: "contract-sign",
      contractFile: "contracts/typeserver.contract.json",
      driftSummary: "observed output shape added cacheHit boolean",
      oldHash: "abc123deadbeef",
      newHash: "def456cafebabe",
    });

    expect(rationale.summary).toContain("typeserver.contract.json");
    expect(rationale.fullReasoning).toContain("cacheHit");
    expect(rationale.evidence?.[0]?.type).toBe("contractDiff");
    expect(rationale.evidence?.[0]?.oldHash).toBe("abc123deadbeef");
  });

  test("builds capability degradation rationale", () => {
    const rationale = buildDecisionRationale({
      kind: "capability-degrade",
      capabilityItem: "typeserver",
      reason: "credential expires in 2 days",
      impactSummary: "No immediate impact on local type-checking.",
    });

    expect(rationale.summary).toContain("typeserver");
    expect(rationale.fullReasoning).toContain("credential expires in 2 days");
    expect(rationale.evidence?.[0]?.type).toBe("capability");
  });

  test("builds generic rationale fallback", () => {
    const rationale = buildDecisionRationale({
      kind: "generic",
      summary: "Enable strict typecheck.",
      fullReasoning: "Strict typecheck catches shared-contract breakage before runtime.",
      evidence: [{ type: "error", errorId: "err-1", detail: "type drift" }],
    });

    expect(rationale.summary).toBe("Enable strict typecheck.");
    expect(rationale.fullReasoning).toContain("shared-contract");
    expect(rationale.evidence).toHaveLength(1);
  });
});
