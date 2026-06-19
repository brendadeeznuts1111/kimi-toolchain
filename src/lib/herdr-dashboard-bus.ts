/**
 * herdr-dashboard-bus.ts — Typed dashboard control-plane events.
 */

import { EventBus } from "./event-bus.ts";
import type { DashboardMetaDiscovery } from "./herdr-dashboard-discovery-meta.ts";
import type {
  DashboardAgentRow,
  DashboardAgentsPayload,
  DashboardFetchOptions,
} from "./herdr-dashboard-data.ts";

export interface DashboardHeartbeatRow {
  agent: string;
  host?: string;
  session?: string;
}

export interface DashboardBusEvents extends Record<string, unknown> {
  "heartbeats:batch": {
    recorded: number;
    agents: DashboardHeartbeatRow[];
    at: string;
  };
  "agent:updated": {
    before: DashboardAgentRow;
    after: DashboardAgentRow;
    at: string;
  };
  "discovery:refreshed": {
    payload: DashboardAgentsPayload;
    fromCache: boolean;
    discovery: DashboardMetaDiscovery;
    at: string;
  };
  "discovery:failed": {
    error: string;
    projectPath: string;
    at: string;
  };
  "config:reloaded": {
    projectPath: string;
    fetchOpts: DashboardFetchOptions;
    at: string;
  };
  /** Herdr unix-socket event routed to dashboard refresh (DX [herdr.orchestrator.events]). */
  "herdr:event": {
    event: string;
    reason: string;
    at: string;
  };
  /** Gate check failure — emitted after agent refresh when doctor gates report failures. */
  "gate:failed": {
    failures: Array<{ name: string; message: string }>;
    count: number;
    at: string;
  };
  /** Gate check cleared — emitted when previously-failing gates pass. */
  "gate:cleared": {
    at: string;
  };
}

export type DashboardEventBus = EventBus<DashboardBusEvents>;

export function createDashboardEventBus(): DashboardEventBus {
  return new EventBus<DashboardBusEvents>();
}
