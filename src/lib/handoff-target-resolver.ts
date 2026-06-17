/**
 * Handoff target pane resolution — fixed vs workspace-scoped least-busy.
 */

import {
  isLegacyGlobalLeastBusyTarget,
  resolveTargetStrategy,
  type HandoffRule,
  type HandoffTargetStrategy,
} from "./herdr-orchestrator-config.ts";
import type { AgentSnapshot, LeastBusyScore } from "./herdr-agent-snapshot.ts";

export function agentsInWorkspace(
  workspaceId: string,
  allAgents: AgentSnapshot[]
): AgentSnapshot[] {
  return allAgents.filter((agent) => agent.workspaceId === workspaceId);
}

/** Agents in a workspace matching a name or `herdr agent rename` label. */
export function agentsMatchingNameOrLabel(
  workspaceId: string,
  nameOrLabel: string,
  allAgents: AgentSnapshot[],
  labelMap?: Map<string, Map<string, string>>
): AgentSnapshot[] {
  const inWorkspace = agentsInWorkspace(workspaceId, allAgents);
  const byName = inWorkspace.filter((agent) => agent.agent === nameOrLabel);
  if (byName.length > 0) return byName;

  const resolved = labelMap?.get(workspaceId)?.get(nameOrLabel);
  if (resolved) {
    return inWorkspace.filter((agent) => agent.agent === resolved);
  }

  return [];
}

export function pickFixedTarget(
  workspaceId: string,
  nameOrLabel: string,
  allAgents: AgentSnapshot[],
  labelMap?: Map<string, Map<string, string>>
): AgentSnapshot | undefined {
  const matches = agentsMatchingNameOrLabel(workspaceId, nameOrLabel, allAgents, labelMap);
  if (matches.length === 0) return undefined;
  return [...matches].sort((a, b) => a.paneId.localeCompare(b.paneId))[0];
}

export function resolveHandoffTargetAgent(options: {
  rule: HandoffRule;
  allAgents: AgentSnapshot[];
  labelMap?: Map<string, Map<string, string>>;
  excludePaneId?: string;
  findLeastBusyAgent: (
    agents: AgentSnapshot[],
    excludeAgent?: string,
    labelFilter?: string,
    labelMap?: Map<string, Map<string, string>>
  ) => LeastBusyScore | null;
}): { agent: AgentSnapshot | undefined; strategy: HandoffTargetStrategy } {
  const { rule, allAgents, labelMap, excludePaneId, findLeastBusyAgent } = options;
  const strategy = resolveTargetStrategy(rule);
  const { toWorkspace, toAgent } = rule;

  if (isLegacyGlobalLeastBusyTarget(toAgent)) {
    const labelFilter = toAgent.startsWith("least_busy:") ? toAgent.slice(11) : undefined;
    return {
      strategy: "least_busy",
      agent: findLeastBusyAgent(allAgents, excludePaneId, labelFilter, labelMap)?.agent,
    };
  }

  if (strategy === "least_busy") {
    const candidates = agentsMatchingNameOrLabel(toWorkspace, toAgent, allAgents, labelMap);
    return {
      strategy,
      agent: findLeastBusyAgent(candidates, excludePaneId)?.agent,
    };
  }

  return {
    strategy: "fixed",
    agent: pickFixedTarget(toWorkspace, toAgent, allAgents, labelMap),
  };
}

/** Human-readable handoff success detail for audit logs and CLI output. */
export function formatHandoffSuccessDetail(options: {
  routePrefix: string;
  rule: HandoffRule;
  targetPaneId: string;
  targetAgentName: string;
  strategy: HandoffTargetStrategy;
}): string {
  const { routePrefix, rule, targetPaneId, targetAgentName, strategy } = options;
  const strategyNote = strategy === "least_busy" ? " least_busy" : "";
  return `${routePrefix}${rule.fromWorkspace}/${rule.fromAgent} → ${rule.toWorkspace}/${rule.toAgent}${strategyNote} (${targetAgentName}@${targetPaneId})`;
}
