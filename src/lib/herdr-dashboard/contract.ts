/**
 * Shared dashboard fetch/session types — breaks data ↔ sessions import cycle.
 */

export interface DashboardSessionCatalogEntry {
  /** Herdr session id; empty string = primary socket. */
  session: string;
  label: string;
  host: string;
  reachable: boolean;
  error?: string;
}

export interface DashboardSessionCatalog {
  sessionsAvailable: string[];
  entries: DashboardSessionCatalogEntry[];
  errors: string[];
}

export interface DashboardFetchOptions {
  sessions?: boolean;
  host?: string;
  domain?: string;
  includeDoctor?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  /** Host labels confirmed reachable by the latest dashboard probe (cache-internal). */
  reachableRemoteHosts?: readonly string[];
  /** Session enumeration from cache (cache-internal; `--sessions` mode). */
  sessionCatalog?: DashboardSessionCatalog;
}
