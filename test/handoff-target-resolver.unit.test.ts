import { describe, expect, test } from "bun:test";
import {
  agentsMatchingNameOrLabel,
  formatHandoffSuccessDetail,
  pickFixedTarget,
  resolveHandoffTargetAgent,
} from "../src/lib/handoff-target-resolver.ts";
import {
  parseHandoffRuleEntry,
  parseTargetStrategy,
  resolveTargetStrategy,
} from "../src/lib/herdr-orchestrator-config.ts";
import { findLeastBusyAgent, type AgentSnapshot } from "../src/lib/herdr-orchestrator.ts";

function agent(
  paneId: string,
  name: string,
  workspaceId: string,
  status: AgentSnapshot["status"] = "idle"
): AgentSnapshot {
  return { paneId, agent: name, workspaceId, status };
}

describe("handoff-target-resolver", () => {
  test("parseTargetStrategy and TOML parseHandoffRuleEntry", () => {
    expect(parseTargetStrategy("least_busy")).toBe("least_busy");
    const rule = parseHandoffRuleEntry({
      from_workspace: "wB",
      from_agent: "kimi",
      condition: "done",
      to_session: "staging:default",
      to_workspace: "staging",
      to_agent: "codex",
      target_strategy: "least_busy",
    });
    expect(rule?.targetStrategy).toBe("least_busy");
    expect(rule?.toAgent).toBe("codex");
    expect(resolveTargetStrategy(rule!)).toBe("least_busy");
  });

  test("resolveTargetStrategy infers least_busy from legacy to_agent", () => {
    expect(
      resolveTargetStrategy({
        fromWorkspace: "w1",
        fromAgent: "kimi",
        condition: "done",
        toWorkspace: "w1",
        toAgent: "least_busy:reviewer",
      })
    ).toBe("least_busy");
  });

  test("agentsMatchingNameOrLabel resolves rename labels", () => {
    const agents = [
      agent("p1", "codex-primary", "staging", "working"),
      agent("p2", "codex-primary", "staging", "idle"),
    ];
    const labelMap = new Map<string, Map<string, string>>();
    labelMap.set("staging", new Map([["codex", "codex-primary"]]));
    const matches = agentsMatchingNameOrLabel("staging", "codex", agents, labelMap);
    expect(matches).toHaveLength(2);
  });

  test("pickFixedTarget chooses lowest pane id deterministically", () => {
    const agents = [agent("p2", "codex", "staging"), agent("p1", "codex", "staging")];
    expect(pickFixedTarget("staging", "codex", agents)?.paneId).toBe("p1");
  });

  test("resolveHandoffTargetAgent picks least busy codex in target workspace", () => {
    const agents = [
      agent("p-kimi", "kimi", "wB", "done"),
      agent("p-c1", "codex", "staging", "working"),
      agent("p-c2", "codex", "staging", "idle"),
      agent("p-c3", "codex", "wB", "idle"),
    ];
    const rule = {
      fromWorkspace: "wB",
      fromAgent: "kimi",
      condition: "done",
      toWorkspace: "staging",
      toAgent: "codex",
      targetStrategy: "least_busy" as const,
    };

    const resolved = resolveHandoffTargetAgent({
      rule,
      allAgents: agents,
      excludePaneId: "p-kimi",
      findLeastBusyAgent,
    });

    expect(resolved.strategy).toBe("least_busy");
    expect(resolved.agent?.paneId).toBe("p-c2");
  });

  test("formatHandoffSuccessDetail includes pane and least_busy strategy", () => {
    const detail = formatHandoffSuccessDetail({
      routePrefix: "",
      rule: {
        fromWorkspace: "wB",
        fromAgent: "kimi",
        condition: "done",
        toWorkspace: "staging",
        toAgent: "codex",
        targetStrategy: "least_busy",
      },
      targetPaneId: "pane-c2",
      targetAgentName: "codex",
      strategy: "least_busy",
    });
    expect(detail).toContain("least_busy");
    expect(detail).toContain("codex@pane-c2");
  });

  test("legacy global least_busy still searches all workspaces", () => {
    const agents = [
      agent("p1", "reviewer", "w1", "working"),
      agent("p2", "reviewer", "w2", "idle"),
    ];
    const resolved = resolveHandoffTargetAgent({
      rule: {
        fromWorkspace: "w1",
        fromAgent: "kimi",
        condition: "done",
        toWorkspace: "w2",
        toAgent: "least_busy",
      },
      allAgents: agents,
      findLeastBusyAgent,
    });
    expect(resolved.agent?.paneId).toBe("p2");
  });
});
