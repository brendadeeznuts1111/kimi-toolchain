import { herdrCliRun } from "./herdr-project-cli.ts";

export interface TabPaneAgentRow {
  paneId: string;
  tabId: string;
  agent: string | null;
}

export function panesWithAgentsOnTab<T extends TabPaneAgentRow>(panes: T[], tabId: string): T[] {
  return panes.filter((pane) => pane.tabId === tabId && pane.agent);
}

export function buildPaneInterruptArgs(paneId: string): string[] {
  return ["pane", "send-keys", paneId, "ctrl+c"];
}

/** Send SIGINT to agent panes before tab close or layout.apply replacement. */
export function interruptPaneAgents(
  session: string,
  panes: Array<{ paneId: string; agent: string | null }>
): string[] {
  const interrupted: string[] = [];
  for (const pane of panes) {
    if (!pane.agent) continue;
    herdrCliRun(session, buildPaneInterruptArgs(pane.paneId));
    interrupted.push(pane.paneId);
  }
  return interrupted;
}
