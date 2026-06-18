/**
 * herdr-dashboard-hub.ts — SSE agent stream, diffing, and heartbeat stale detection.
 */

import { inspectAgent } from "./inspect.ts";
import {
  type DashboardAgentRow,
  type DashboardAgentsPayload,
  type DashboardFetchOptions,
} from "./herdr-dashboard-data.ts";
import { createDashboardEventBus, type DashboardEventBus } from "./herdr-dashboard-bus.ts";
import {
  HerdrDashboardDiscoveryCache,
  type DashboardCacheStats,
} from "./herdr-dashboard-discovery-cache.ts";

/** Sub-minute SSE poll — Bun.cron is minute-granularity; setInterval is intentional here. */
export const DASHBOARD_SSE_INTERVAL_MS = 5000;
export const DASHBOARD_STALE_MS = 15_000;

export interface DashboardHubOptions {
  projectPath: string;
  fetchOpts: DashboardFetchOptions;
  pollMs?: number;
  staleMs?: number;
  bus?: DashboardEventBus;
  discoveryCache?: HerdrDashboardDiscoveryCache;
}

type SseController = ReadableStreamDefaultController<Uint8Array>;

function agentKey(row: Pick<DashboardAgentRow, "host" | "session" | "agent">): string {
  return `${row.host}|${row.session}|${row.agent}`;
}

/** In-memory agent registry with SSE broadcast and heartbeat overlays. */
export class HerdrDashboardHub {
  private readonly staleMs: number;
  private readonly pollMs: number;
  private readonly bus: DashboardEventBus;
  readonly discoveryCache: HerdrDashboardDiscoveryCache;
  private lastAgentsJson = "";
  private lastPayload: DashboardAgentsPayload | null = null;
  private readonly agentSnapshot = new Map<string, DashboardAgentRow>();
  private readonly subscribers = new Set<SseController>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  constructor(options: DashboardHubOptions) {
    this.pollMs = options.pollMs ?? DASHBOARD_SSE_INTERVAL_MS;
    this.staleMs = options.staleMs ?? DASHBOARD_STALE_MS;
    this.bus = options.bus ?? createDashboardEventBus();
    this.discoveryCache =
      options.discoveryCache ??
      new HerdrDashboardDiscoveryCache({
        projectPath: options.projectPath,
        fetchOpts: options.fetchOpts,
        ttlMs: this.pollMs,
        bus: this.bus,
        onDiscoveryRefreshed: (payload) => {
          void this.ingestDiscoveryPayload(payload);
        },
      });
  }

  get eventBus(): DashboardEventBus {
    return this.bus;
  }

  cacheStats(): DashboardCacheStats {
    return this.discoveryCache.stats();
  }

  recordHeartbeat(agent: string, host = "(local)", session = ""): void {
    this.discoveryCache.recordHeartbeat(agent, host, session);
  }

  recordHeartbeats(
    rows: ReadonlyArray<{ agent: string; host?: string; session?: string }>
  ): number {
    return this.discoveryCache.recordHeartbeats(rows);
  }

  applyStaleOverlay(agents: DashboardAgentRow[]): DashboardAgentRow[] {
    const now = Date.now();
    return agents.map((row) => {
      const last = this.discoveryCache.getHeartbeatAt(row);
      if (last !== undefined && now - last > this.staleMs) {
        return { ...row, status: "stale" };
      }
      return row;
    });
  }

  private emitAgentUpdates(before: DashboardAgentRow[], after: DashboardAgentRow[]): void {
    const beforeMap = new Map(before.map((row) => [agentKey(row), row]));
    for (const row of after) {
      const prev = beforeMap.get(agentKey(row));
      if (prev && prev.status !== row.status) {
        this.bus.emit("agent:updated", {
          before: prev,
          after: row,
          at: new Date().toISOString(),
        });
      }
    }
  }

  private trackAgentSnapshot(agents: DashboardAgentRow[]): void {
    const previous = [...this.agentSnapshot.values()];
    this.agentSnapshot.clear();
    for (const row of agents) {
      this.agentSnapshot.set(agentKey(row), row);
    }
    this.emitAgentUpdates(previous, agents);
  }

  private async ingestDiscoveryPayload(raw: DashboardAgentsPayload): Promise<void> {
    if (!raw.ok) {
      this.lastPayload = raw;
      this.broadcast(raw);
      return;
    }

    const agents = this.applyStaleOverlay(raw.agents);
    const payload: DashboardAgentsPayload = {
      ...raw,
      agents,
      agentCount: agents.length,
    };
    this.lastPayload = payload;

    const json = JSON.stringify(agents);
    if (json !== this.lastAgentsJson) {
      this.lastAgentsJson = json;
      this.trackAgentSnapshot(agents);
      this.broadcast(payload);
    }
  }

  async refresh(options: { forceRefresh?: boolean } = {}): Promise<DashboardAgentsPayload> {
    const raw = await this.discoveryCache.getAgents(options);
    await this.ingestDiscoveryPayload(raw);
    return this.lastPayload ?? raw;
  }

  private broadcast(payload: DashboardAgentsPayload): void {
    const chunk = `data: ${inspectAgent(payload)}\n\n`;
    const bytes = new TextEncoder().encode(chunk);
    for (const controller of this.subscribers) {
      try {
        controller.enqueue(bytes);
      } catch {
        this.subscribers.delete(controller);
      }
    }
  }

  /** Resume sub-minute polling when at least one SSE subscriber is connected. */
  private resumePolling(): void {
    if (this.pollTimer || this.subscribers.size === 0) return;
    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, this.pollMs);
  }

  /** Pause polling when no SSE subscribers remain. */
  private pausePolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  start(): void {
    if (this.subscribers.size > 0) this.resumePolling();
  }

  stop(): void {
    this.pausePolling();
    for (const controller of this.subscribers) {
      try {
        controller.close();
      } catch {
        /* ignore */
      }
    }
    this.subscribers.clear();
  }

  private enqueuePayload(controller: SseController, payload: DashboardAgentsPayload): void {
    if (!this.subscribers.has(controller)) return;
    const chunk = `data: ${inspectAgent(payload)}\n\n`;
    try {
      controller.enqueue(new TextEncoder().encode(chunk));
    } catch {
      this.subscribers.delete(controller);
    }
  }

  createAgentsLiveStream(): ReadableStream<Uint8Array> {
    let active: SseController | null = null;
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        active = controller;
        const wasEmpty = this.subscribers.size === 0;
        this.subscribers.add(controller);
        if (wasEmpty) {
          this.resumePolling();
        }
        if (this.lastPayload) {
          this.enqueuePayload(controller, this.lastPayload);
          return;
        }
        void (async () => {
          const payload = await this.refresh();
          this.enqueuePayload(controller, payload);
        })();
      },
      cancel: () => {
        if (!active) return;
        this.subscribers.delete(active);
        if (this.subscribers.size === 0) {
          this.pausePolling();
        }
      },
    });
  }
}
