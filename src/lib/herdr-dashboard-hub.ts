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
import { startDashboardCron } from "./herdr-dashboard-cron.ts";
import { Logger } from "./logger.ts";

/** Default SSE poll interval in milliseconds. Bun.cron rounds to whole minutes; sub-minute intervals use setInterval. */
export const DASHBOARD_SSE_INTERVAL_MS = 5000;
export const DASHBOARD_STALE_MS = 15_000;

export interface DashboardHubOptions {
  projectPath: string;
  fetchOpts: DashboardFetchOptions;
  pollMs?: number;
  staleMs?: number;
  bus?: DashboardEventBus;
  discoveryCache?: HerdrDashboardDiscoveryCache;
  logger?: Logger;
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
  private readonly logger: Logger;
  readonly discoveryCache: HerdrDashboardDiscoveryCache;
  private lastAgentsJson = "";
  private lastPayload: DashboardAgentsPayload | null = null;
  private readonly agentSnapshot = new Map<string, DashboardAgentRow>();
  private readonly subscribers = new Set<SseController>();
  private cronJob: Disposable | null = null;
  private readonly busUnsubs: Array<() => void> = [];
  private discovering = false;

  constructor(options: DashboardHubOptions) {
    this.pollMs = options.pollMs ?? DASHBOARD_SSE_INTERVAL_MS;
    this.staleMs = options.staleMs ?? DASHBOARD_STALE_MS;
    this.bus = options.bus ?? createDashboardEventBus();
    this.logger = options.logger ?? new Logger({ tool: "herdr-dashboard-hub" });
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

    this.busUnsubs.push(
      this.bus.on("herdr:event", () => {
        this.discoveryCache.invalidateDiscovery();
        void this.refresh({ forceRefresh: true });
      })
    );
  }

  get eventBus(): DashboardEventBus {
    return this.bus;
  }

  /** Poll interval exposed for cron schedule construction. */
  get ssePollMs(): number {
    return this.pollMs;
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

    this.discoveryCache.recordHeartbeats(
      raw.agents.map((row) => ({
        agent: row.agent,
        host: row.host,
        session: row.session,
      })),
      { emit: false }
    );
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
      return;
    }
    if (this.subscribers.size > 0) {
      this.broadcast(payload);
    }
  }

  async refresh(options: { forceRefresh?: boolean } = {}): Promise<DashboardAgentsPayload> {
    const raw = await this.discoveryCache.getAgents(options);
    await this.ingestDiscoveryPayload(raw);
    return this.lastPayload ?? raw;
  }

  /**
   * Background discovery refresh used by the cron scheduler.
   *
   * Skips overlapping invocations: if a previous refresh is still in flight,
   * this is a no-op and logged at debug level.
   */
  async refreshDiscovery(): Promise<void> {
    if (this.discovering) {
      this.logger.debug("Discovery refresh skipped — previous run still in flight");
      return;
    }
    this.discovering = true;
    try {
      await this.refresh();
    } finally {
      this.discovering = false;
    }
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

  /** Background discovery poll — runs while the dashboard server is up (not only during SSE). */
  private resumePolling(): void {
    if (this.cronJob) return;
    this.cronJob = startDashboardCron({
      ssePollMs: this.pollMs,
      refresh: () => this.refreshDiscovery(),
      logger: this.logger,
    });
  }

  private pausePolling(): void {
    if (!this.cronJob) return;
    this.cronJob[Symbol.dispose]();
    this.cronJob = null;
  }

  start(): void {
    this.resumePolling();
  }

  stop(): void {
    this.pausePolling();
    for (const off of this.busUnsubs) off();
    this.busUnsubs.length = 0;
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
      },
    });
  }
}
