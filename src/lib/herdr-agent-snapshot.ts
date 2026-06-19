/**
 * Shared agent snapshot types — breaks orchestrator ↔ handoff-target-resolver cycles.
 */

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface AgentSnapshot {
  paneId: string;
  agent: string;
  status: AgentStatus;
  workspaceId: string;
  tabId?: string;
  customStatus?: string;
}

export interface LeastBusyScore {
  agent: AgentSnapshot;
  score: number;
  breakdown: string;
}
