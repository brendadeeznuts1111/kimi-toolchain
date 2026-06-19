/**
 * herdr-dashboard-events.ts — Bridge Herdr socket events into the dashboard EventBus.
 *
 * Uses DX `[herdr.orchestrator.events]` allowlist + debounce (same as watch-events).
 * Does not run react/context-sync — only invalidates discovery cache and refreshes agents.
 */

import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { loadMergedHerdrDocument } from "./herdr-merged-config.ts";
import { findWorkspaceForProject } from "./herdr-project-runner.ts";
import { listWorkspaceAgents } from "./herdr-orchestrator.ts";
import { resolveOrchestratorConfig } from "./herdr-orchestrator-config.ts";
import {
  buildHerdrWorkspaceEventSubscriptions,
  normalizeHerdrEventName,
} from "./herdr-orchestrator-events.ts";
import type { HerdrDashboardHub } from "./herdr-dashboard-hub.ts";
import { herdrSocketSubscribe, type HerdrStreamEnvelope } from "./herdr-socket-client.ts";

export type DashboardHerdrEventAction = "refresh-agents";

export interface DashboardHerdrEventDispatch {
  action: DashboardHerdrEventAction;
  reason: string;
  event: string;
}

export interface DashboardHerdrEventBridgeStatus {
  enabled: boolean;
  pending?: boolean;
  connected: boolean;
  workspaceId: string | null;
  subscriptionCount: number;
  debounceMs: number;
  error?: string;
}

export interface StartDashboardHerdrEventBridgeOptions {
  projectPath: string;
  hub: HerdrDashboardHub;
  /** When false, skip socket bridge entirely. Default: true. */
  herdrEvents?: boolean;
  /** When false, report enabled status but defer the socket connection. */
  connect?: boolean;
  signal?: AbortSignal;
}

export interface DashboardHerdrEventBridgeHandle {
  stop: () => void;
  status: () => DashboardHerdrEventBridgeStatus;
}

class DebouncedDashboardRefresh {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  schedule(key: string, debounceMs: number, fn: () => void) {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      fn();
    }, debounceMs);
    this.timers.set(key, timer);
  }

  clear() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

/** Map Herdr socket envelopes to dashboard agent refresh (subset of watch-events routing). */
export function routeDashboardHerdrEvent(
  envelope: HerdrStreamEnvelope,
  allowlist: string[] | null
): DashboardHerdrEventDispatch | null {
  const event = normalizeHerdrEventName(envelope.event || "");
  if (!event) return null;

  const data = envelope.data || {};
  const customStatus = typeof data.custom_status === "string" ? data.custom_status : undefined;

  let logical = event;
  if (customStatus === "workspace.updated") logical = "workspace.updated";

  if (allowlist && !allowlist.includes(logical) && !allowlist.includes(event)) {
    return null;
  }

  if (logical === "workspace.updated" || event === "workspace.updated") {
    return { action: "refresh-agents", reason: "workspace.updated", event: logical };
  }

  if (event === "pane.agent_status_changed" || event === "pane.agent.status.changed") {
    return { action: "refresh-agents", reason: "pane.agent_status_changed", event };
  }

  return null;
}

/** Subscribe to Herdr socket events and push refreshes through the dashboard EventBus. */
export function startDashboardHerdrEventBridge(
  options: StartDashboardHerdrEventBridgeOptions
): DashboardHerdrEventBridgeHandle {
  const status: DashboardHerdrEventBridgeStatus = {
    enabled: options.herdrEvents !== false,
    pending: options.herdrEvents !== false,
    connected: false,
    workspaceId: null,
    subscriptionCount: 0,
    debounceMs: 0,
  };

  let socket: ReturnType<typeof herdrSocketSubscribe> | null = null;
  let abort: AbortController | null = null;
  let stopped = false;
  const debouncer = new DebouncedDashboardRefresh();

  const stop = () => {
    stopped = true;
    debouncer.clear();
    abort?.abort();
    abort = null;
    socket?.end();
    socket = null;
    status.connected = false;
  };

  if (!status.enabled) {
    return { stop, status: () => ({ ...status }) };
  }
  if (options.connect === false) {
    status.pending = false;
    status.error = "event bridge deferred";
    return { stop, status: () => ({ ...status }) };
  }

  void (async () => {
    await Bun.sleep(0);
    if (stopped) return;
    const config = discoverHerdrProjectConfig(options.projectPath);
    if (stopped) return;
    status.pending = false;
    if (!config?.enabled) {
      status.error = "no enabled [herdr] profile";
      return;
    }

    const full = { ...config, projectPath: options.projectPath };
    const doc = await loadMergedHerdrDocument(options.projectPath, config.sourcePath);
    if (stopped) return;
    const orchestrator = resolveOrchestratorConfig(full, doc);
    if (!orchestrator.enabled || !orchestrator.events.enabled) {
      status.enabled = false;
      status.error = "orchestrator events disabled";
      return;
    }

    status.debounceMs = orchestrator.events.debounceMs;

    const match = findWorkspaceForProject(full);
    if (stopped) return;
    if (!match.workspaceId) {
      status.error = match.reason || "workspace not open";
      return;
    }

    const workspaceId = match.workspaceId;
    status.workspaceId = workspaceId;

    const listed = listWorkspaceAgents(workspaceId, config.session);
    if (stopped) return;
    if (!listed.ok) {
      status.error = listed.error || "agent list failed";
      return;
    }

    const paneIds = [...new Set(listed.agents.map((row) => row.paneId))];
    const subscriptions = buildHerdrWorkspaceEventSubscriptions(workspaceId, paneIds);
    status.subscriptionCount = subscriptions.length;

    abort = new AbortController();
    if (options.signal) {
      options.signal.addEventListener("abort", () => stop(), { once: true });
    }

    const eventsConfig = orchestrator.events;
    const bus = options.hub.eventBus;

    socket = herdrSocketSubscribe({
      subscriptions,
      session: config.session,
      signal: abort.signal,
      onError: (error) => {
        status.connected = false;
        status.error = error;
      },
      onEvent: (envelope) => {
        status.connected = true;
        status.error = undefined;

        const data = envelope.data || {};
        const eventWorkspace =
          typeof data.workspace_id === "string"
            ? data.workspace_id
            : typeof (data.workspace as { workspace_id?: string } | undefined)?.workspace_id ===
                "string"
              ? (data.workspace as { workspace_id: string }).workspace_id
              : undefined;

        if (eventWorkspace && eventWorkspace !== workspaceId) return;

        const routed = routeDashboardHerdrEvent(envelope, eventsConfig.allowlist);
        if (!routed) return;

        debouncer.schedule(routed.reason, eventsConfig.debounceMs, () => {
          const at = new Date().toISOString();
          bus.emit("herdr:event", {
            event: routed.event,
            reason: routed.reason,
            at,
          });
        });
      },
    });

    socket.on("close", () => {
      status.connected = false;
      if (!abort?.signal.aborted) {
        status.error = "herdr event stream closed";
      }
    });
  })();

  return { stop, status: () => ({ ...status }) };
}
