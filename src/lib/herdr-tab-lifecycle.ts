import { sendKeysSync } from "./herdr-pane-service.ts";

/** @deprecated Use sendKeysSync from herdr-pane-service instead. */
export function buildPaneInterruptArgs(paneId: string): string[] {
  return ["pane", "send-keys", paneId, "ctrl+c"];
}

export interface TabPaneAgentRow {
  paneId: string;
  tabId: string;
  agent: string | null;
}

export function panesWithAgentsOnTab<T extends TabPaneAgentRow>(panes: T[], tabId: string): T[] {
  return panes.filter((pane) => pane.tabId === tabId && pane.agent);
}

/** Send SIGINT to agent panes before tab close or layout.apply replacement. */
export function interruptPaneAgents(
  session: string,
  panes: Array<{ paneId: string; agent: string | null }>
): string[] {
  const interrupted: string[] = [];
  for (const pane of panes) {
    if (!pane.agent) continue;
    sendKeysSync(pane.paneId, "ctrl+c", session);
    interrupted.push(pane.paneId);
  }
  return interrupted;
}
