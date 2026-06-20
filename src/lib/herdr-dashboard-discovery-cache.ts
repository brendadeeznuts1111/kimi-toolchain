/**
 * herdr-dashboard-discovery-cache.ts — Cached agent discovery + heartbeat status snapshots.
 */

import { TtlCache, type CacheStats } from "./cache.ts";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { buildDashboardMetaDiscovery } from "./herdr-dashboard-discovery-meta.ts";
import { getDashboardAgents } from "./herdr-dashboard-agents.ts";
import {
  buildEmptySessionCatalog,
  buildSingleSessionCatalog,
  discoverAllSessions,
  type DashboardSessionCatalog,
} from "./herdr-dashboard-sessions.ts";
import type { DashboardEventBus } from "./herdr-dashboard-bus.ts";
import type {
  DashboardAgentRow,
  DashboardAgentsPayload,
  DashboardFetchOptions,
} from "./herdr-dashboard-data.ts";
import {
  buildEmptyRemoteHostsStatus,
  probeProjectRemoteHosts,
  type DashboardRemoteHostsStatus,
} from "./herdr-remote-host-probe.ts";

const defaultProbeRemoteHosts = probeProjectRemoteHosts;

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
  probeRemoteHosts?: (projectPath: string) => Promise<DashboardRemoteHostsStatus>;
  enumerateSessions?: (
    projectPath: string,
    fetchOpts: DashboardFetchOptions
  ) => Promise<DashboardSessionCatalog>;
}

function cacheKey(projectPath: string, fetchOpts: DashboardFetchOptions): string {
  const { reachableRemoteHosts: _reachable, sessionCatalog: _catalog, ...rest } = fetchOpts;
  return `${projectPath}|${JSON.stringify(rest)}`;
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
  private readonly probeRemoteHosts: (projectPath: string) => Promise<DashboardRemoteHostsStatus>;
  private readonly hasCustomRemoteHostProbe: boolean;
  private readonly enumerateSessions: (
    projectPath: string,
    fetchOpts: DashboardFetchOptions
  ) => Promise<DashboardSessionCatalog>;
  private readonly discoveryCache: TtlCache<DashboardAgentsPayload>;
  private readonly ttlMs: number;
  private readonly statusCache = new Map<string, DashboardStatusSnapshot>();
  private statusLastRecordedAt: number | undefined;
  private sessionCatalogFetchedAt = 0;
  private refreshInFlight: Promise<DashboardAgentsPayload> | null = null;
  private probeInFlight: Promise<DashboardRemoteHostsStatus> | null = null;
  private sessionsInFlight: Promise<DashboardSessionCatalog> | null = null;
  private remoteHostsStatus: DashboardRemoteHostsStatus = buildEmptyRemoteHostsStatus();
  private sessionCatalog: DashboardSessionCatalog = buildEmptySessionCatalog();
  private discoveryMeta: ReturnType<typeof buildDashboardMetaDiscovery>;

  constructor(options: HerdrDashboardDiscoveryCacheOptions) {
    this.projectPath = options.projectPath;
    this.fetchOpts = options.fetchOpts;
    this.bus = options.bus;
    this.onDiscoveryRefreshed = options.onDiscoveryRefreshed;
    this.discover = options.discover ?? getDashboardAgents;
    this.hasCustomRemoteHostProbe = options.probeRemoteHosts !== undefined;
    this.probeRemoteHosts = options.probeRemoteHosts ?? defaultProbeRemoteHosts;
    this.enumerateSessions = options.enumerateSessions ?? discoverAllSessions;
    this.ttlMs = options.ttlMs;
    this.discoveryCache = new TtlCache<DashboardAgentsPayload>({ ttlMs: options.ttlMs });
    const config = discoverHerdrProjectConfig(this.projectPath);
    this.sessionCatalog = buildSingleSessionCatalog(config?.session ?? "");
    this.discoveryMeta = buildDashboardMetaDiscovery(
      this.projectPath,
      this.fetchOpts,
      this.remoteHostsStatus,
      this.sessionCatalog,
      { resolveWorkspace: false }
    );
  }

  discoveryContext(): ReturnType<typeof buildDashboardMetaDiscovery> {
    return this.discoveryMeta;
  }

  remoteHostsStatusSnapshot(): DashboardRemoteHostsStatus {
    return this.remoteHostsStatus;
  }

  private key(): string {
    return cacheKey(this.projectPath, this.fetchOpts);
  }

  private remoteHostProbeEnabled(): boolean {
    return Boolean(
      this.hasCustomRemoteHostProbe ||
      this.fetchOpts.sessions === true ||
      this.fetchOpts.host?.trim() ||
      this.fetchOpts.domain?.trim()
    );
  }

  private rebuildDiscoveryMeta(): void {
    this.discoveryMeta = buildDashboardMetaDiscovery(
      this.projectPath,
      this.fetchOpts,
      this.remoteHostProbeEnabled() ? this.remoteHostsStatus : undefined,
      this.sessionCatalog,
      { resolveWorkspace: false }
    );
  }

  private reachableRemoteHostLabels(): string[] {
    return this.remoteHostsStatus.hosts.filter((host) => host.reachable).map((host) => host.label);
  }

  private discoverFetchOptsBase(): DashboardFetchOptions {
    const reachable = this.reachableRemoteHostLabels();
    if (reachable.length === 0 && this.remoteHostsStatus.configured === 0) {
      return this.fetchOpts;
    }
    return {
      ...this.fetchOpts,
      reachableRemoteHosts: reachable,
    };
  }

  private discoverFetchOpts(): DashboardFetchOptions {
    return {
      ...this.discoverFetchOptsBase(),
      sessionCatalog: this.sessionCatalog,
    };
  }

  private async refreshRemoteHostStatus(): Promise<DashboardRemoteHostsStatus> {
    if (!this.remoteHostProbeEnabled()) {
      this.remoteHostsStatus = buildEmptyRemoteHostsStatus();
      this.rebuildDiscoveryMeta();
      return this.remoteHostsStatus;
    }
    if (this.probeInFlight) return this.probeInFlight;

    const run = async (): Promise<DashboardRemoteHostsStatus> => {
      try {
        this.remoteHostsStatus = await this.probeRemoteHosts(this.projectPath);
        this.rebuildDiscoveryMeta();
        return this.remoteHostsStatus;
      } finally {
        this.probeInFlight = null;
      }
    };

    this.probeInFlight = run();
    return this.probeInFlight;
  }

  private sessionCatalogFresh(): boolean {
    return (
      this.sessionCatalogFetchedAt > 0 && Date.now() - this.sessionCatalogFetchedAt < this.ttlMs
    );
  }

  private async refreshSessionCatalog(force = false): Promise<DashboardSessionCatalog> {
    if (!force && this.sessionCatalogFresh()) {
      return this.sessionCatalog;
    }
    if (this.sessionsInFlight) return this.sessionsInFlight;

    const run = async (): Promise<DashboardSessionCatalog> => {
      try {
        if (!this.fetchOpts.sessions) {
          this.sessionCatalogFetchedAt = Date.now();
          this.rebuildDiscoveryMeta();
          return this.sessionCatalog;
        } else {
          this.sessionCatalog = await this.enumerateSessions(
            this.projectPath,
            this.discoverFetchOptsBase()
          );
        }
        this.sessionCatalogFetchedAt = Date.now();
        this.rebuildDiscoveryMeta();
        return this.sessionCatalog;
      } finally {
        this.sessionsInFlight = null;
      }
    };

    this.sessionsInFlight = run();
    return this.sessionsInFlight;
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
    this.sessionCatalogFetchedAt = 0;
    void this.refreshRemoteHostStatus();
    void this.refreshSessionCatalog(true);
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
    rows: ReadonlyArray<{ agent: string; host?: string; session?: string }>,
    options: { emit?: boolean } = {}
  ): number {
    const emit = options.emit !== false;
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
      if (emit) {
        this.bus?.emit("heartbeats:batch", {
          recorded,
          agents: rows
            .filter((r) => r.agent)
            .map((r) => ({ agent: r.agent, host: r.host, session: r.session })),
          at: new Date().toISOString(),
        });
      }
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
        await this.refreshRemoteHostStatus();
        await this.refreshSessionCatalog();
        const payload = await this.discover(this.projectPath, this.discoverFetchOpts());
        this.discoveryCache.set(this.key(), payload);
        if (!payload.ok) {
          this.bus?.emit("discovery:failed", {
            error: payload.error ?? "discovery failed",
            projectPath: this.projectPath,
            at: new Date().toISOString(),
          });
        } else {
          this.bus?.emit("discovery:refreshed", {
            payload,
            fromCache: false,
            discovery: this.discoveryMeta,
            at: new Date().toISOString(),
          });
          if (options.notify) {
            this.onDiscoveryRefreshed?.(payload);
          }
        }
        return payload;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : Bun.inspect(error);
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
