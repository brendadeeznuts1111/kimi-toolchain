/**
 * herdr-dashboard-discovery-cache.ts — Cached agent discovery + heartbeat status snapshots.
 */

import { TtlCache, type CacheStats } from "./cache.ts";
import { getDashboardAgents } from "./herdr-dashboard-agents.ts";
import type { DashboardEventBus } from "./herdr-dashboard-bus.ts";
import type {
  DashboardAgentRow,
  DashboardAgentsPayload,
  DashboardFetchOptions,
} from "./herdr-dashboard-data.ts";

export interface DashboardStatusSnapshot {
  agent: string;
  host: string;
  session: string;
  recordedAt: number;
}

export interface DashboardCacheStats {
  discovery: CacheStats;
  status: { size: number; lastRecordedAt?: number };
}

export interface HerdrDashboardDiscoveryCacheOptions {
  projectPath: string;
  fetchOpts: DashboardFetchOptions;
  /** Discovery TTL — typically matches ssePollMs. */
  ttlMs: number;
  bus?: DashboardEventBus;
  /** Called after background stale-while-revalidate refresh completes. */
  onDiscoveryRefreshed?: (payload: DashboardAgentsPayload) => void;
  discover?: (
    projectPath: string,
    fetchOpts: DashboardFetchOptions
  ) => Promise<DashboardAgentsPayload>;
}

function cacheKey(projectPath: string, fetchOpts: DashboardFetchOptions): string {
  return `${projectPath}|${JSON.stringify(fetchOpts)}`;
}

function agentKey(row: Pick<DashboardAgentRow, "host" | "session" | "agent">): string {
  return `${row.host}|${row.session}|${row.agent}`;
}

/** Cached agent discovery with stale-while-revalidate and event emission. */
export class HerdrDashboardDiscoveryCache {
  private readonly projectPath: string;
  private fetchOpts: DashboardFetchOptions;
  private readonly bus?: DashboardEventBus;
  private readonly onDiscoveryRefreshed?: (payload: DashboardAgentsPayload) => void;
  private readonly discover: (
    projectPath: string,
    fetchOpts: DashboardFetchOptions
  ) => Promise<DashboardAgentsPayload>;
  private readonly discoveryCache: TtlCache<DashboardAgentsPayload>;
  private readonly statusCache = new Map<string, DashboardStatusSnapshot>();
  private statusLastRecordedAt: number | undefined;
  private refreshInFlight: Promise<DashboardAgentsPayload> | null = null;

  constructor(options: HerdrDashboardDiscoveryCacheOptions) {
    this.projectPath = options.projectPath;
    this.fetchOpts = options.fetchOpts;
    this.bus = options.bus;
    this.onDiscoveryRefreshed = options.onDiscoveryRefreshed;
    this.discover = options.discover ?? getDashboardAgents;
    this.discoveryCache = new TtlCache<DashboardAgentsPayload>({ ttlMs: options.ttlMs });
  }

  private key(): string {
    return cacheKey(this.projectPath, this.fetchOpts);
  }

  stats(): DashboardCacheStats {
    return {
      discovery: this.discoveryCache.stats(),
      status: {
        size: this.statusCache.size,
        lastRecordedAt: this.statusLastRecordedAt,
      },
    };
  }

  invalidateDiscovery(): void {
    this.discoveryCache.invalidate(this.key());
  }

  reloadConfig(fetchOpts: DashboardFetchOptions): void {
    this.fetchOpts = fetchOpts;
    this.discoveryCache.invalidateAll();
    this.bus?.emit("config:reloaded", {
      projectPath: this.projectPath,
      fetchOpts,
      at: new Date().toISOString(),
    });
  }

  recordHeartbeat(agent: string, host = "(local)", session = ""): void {
    this.recordHeartbeats([{ agent, host, session }]);
  }

  recordHeartbeats(
    rows: ReadonlyArray<{ agent: string; host?: string; session?: string }>
  ): number {
    const now = Date.now();
    let recorded = 0;
    for (const row of rows) {
      if (!row.agent) continue;
      const host = row.host ?? "(local)";
      const session = row.session ?? "";
      this.statusCache.set(agentKey({ host, session, agent: row.agent }), {
        agent: row.agent,
        host,
        session,
        recordedAt: now,
      });
      recorded += 1;
    }
    if (recorded > 0) {
      this.statusLastRecordedAt = now;
      this.bus?.emit("heartbeats:batch", {
        recorded,
        agents: rows
          .filter((r) => r.agent)
          .map((r) => ({ agent: r.agent, host: r.host, session: r.session })),
        at: new Date().toISOString(),
      });
    }
    return recorded;
  }

  getHeartbeatAt(row: Pick<DashboardAgentRow, "host" | "session" | "agent">): number | undefined {
    return this.statusCache.get(agentKey(row))?.recordedAt;
  }

  async getAgents(options: { forceRefresh?: boolean } = {}): Promise<DashboardAgentsPayload> {
    const key = this.key();
    if (!options.forceRefresh) {
      const peek = this.discoveryCache.peek(key);
      if (peek) {
        if (peek.stale) {
          void this.refreshInBackground();
          return peek.value;
        }
        return this.discoveryCache.get(key) ?? peek.value;
      }
    }
    return this.fetchAndStore({ notify: false });
  }

  private refreshInBackground(): void {
    if (this.refreshInFlight) return;
    void this.fetchAndStore({ notify: true });
  }

  private async fetchAndStore(options: { notify: boolean }): Promise<DashboardAgentsPayload> {
    if (this.refreshInFlight) return this.refreshInFlight;

    const run = async (): Promise<DashboardAgentsPayload> => {
      try {
        const payload = await this.discover(this.projectPath, this.fetchOpts);
        this.discoveryCache.set(this.key(), payload);
        if (!payload.ok) {
          this.bus?.emit("discovery:failed", {
            error: payload.error ?? "discovery failed",
            projectPath: this.projectPath,
            at: new Date().toISOString(),
          });
        } else if (options.notify) {
          this.bus?.emit("discovery:refreshed", {
            payload,
            fromCache: false,
            at: new Date().toISOString(),
          });
          this.onDiscoveryRefreshed?.(payload);
        }
        return payload;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.bus?.emit("discovery:failed", {
          error: message,
          projectPath: this.projectPath,
          at: new Date().toISOString(),
        });
        throw error;
      } finally {
        this.refreshInFlight = null;
      }
    };

    this.refreshInFlight = run();
    return this.refreshInFlight;
  }
}
