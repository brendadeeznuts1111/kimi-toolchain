/**
 * herdr-dashboard/sessions.ts — Enumerate Herdr sessions (local + remote) for multi-session dashboard.
 */

import { TOML } from "bun";
import { pathExists, readText } from "../bun-io.ts";
import { discoverHerdrProjectConfig } from "../herdr-project-config.ts";
import { resolveHerdrSocketPath } from "../herdr-unix-socket.ts";
import { discoverRemoteSessions } from "../herdr-orchestrator.ts";
import { resolveOrchestratorConfig } from "../herdr-orchestrator-config.ts";
import { herdrCliJson } from "../herdr-project-cli.ts";
import type {
  DashboardFetchOptions,
  DashboardSessionCatalog,
  DashboardSessionCatalogEntry,
} from "./contract.ts";

export type { DashboardSessionCatalog, DashboardSessionCatalogEntry } from "./contract.ts";

/** Dashboard Herdr CLI budget — fail fast so refresh/SSE polls stay responsive. */
export const DASHBOARD_HERDR_CLI_TIMEOUT_MS = 2_500;

/** Per-session agent collection timeout (heavier than host version probe). */
export const DASHBOARD_SESSION_FETCH_TIMEOUT_MS = DASHBOARD_HERDR_CLI_TIMEOUT_MS;

function herdrSessionLabel(session: string): string {
  const trimmed = session.trim();
  return trimmed.length > 0 ? trimmed : "primary";
}

function loadOrchestratorDocument(sourcePath: string | null): Record<string, unknown> | null {
  if (!sourcePath) return null;
  try {
    return TOML.parse(readText(sourcePath)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sortSessionIds(ids: readonly string[]): string[] {
  const unique = [...new Set(ids.map((id) => id.trim()))];
  return unique.sort((a, b) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b);
  });
}

export function buildSingleSessionCatalog(session = ""): DashboardSessionCatalog {
  const normalized = session.trim();
  return {
    sessionsAvailable: [normalized],
    entries: [
      {
        session: normalized,
        label: herdrSessionLabel(normalized),
        host: "(local)",
        reachable: true,
      },
    ],
    errors: [],
  };
}

export function buildEmptySessionCatalog(): DashboardSessionCatalog {
  return buildSingleSessionCatalog("");
}

/** Merge catalog entries; dedupe sessionsAvailable by session id (primary first). */
export function finalizeSessionCatalog(
  entries: DashboardSessionCatalogEntry[],
  errors: string[] = []
): DashboardSessionCatalog {
  const sessionsAvailable = sortSessionIds(entries.map((entry) => entry.session));
  return { sessionsAvailable, entries, errors };
}

/** Local Herdr sessions from `herdr session list` (no remote scan). */
export function discoverLocalSessionsCatalog(errors: string[] = []): DashboardSessionCatalog {
  return finalizeSessionCatalog(discoverLocalSessionEntries(errors), errors);
}

/** Async wrapper for discovery cache (projectPath reserved for future workspace overrides). */
export async function discoverLocalSessions(
  _projectPath: string
): Promise<DashboardSessionCatalog> {
  const errors: string[] = [];
  return discoverLocalSessionsCatalog(errors);
}

function discoverLocalSessionEntries(errors: string[]): DashboardSessionCatalogEntry[] {
  const entries: DashboardSessionCatalogEntry[] = [
    { session: "", label: "primary", host: "(local)", reachable: true },
  ];

  const socketPath = resolveHerdrSocketPath("");
  if (!pathExists(socketPath)) {
    return entries;
  }

  const sessionsRaw = herdrCliJson("", ["session", "list"], DASHBOARD_SESSION_FETCH_TIMEOUT_MS);
  if (!sessionsRaw.ok) {
    errors.push(sessionsRaw.error ?? "local session list failed");
    return entries;
  }

  const sessionList =
    (sessionsRaw.json as { sessions?: Array<{ name: string; running: boolean }> })?.sessions ?? [];

  for (const row of sessionList) {
    const name = row.name?.trim();
    if (!name) continue;
    if (row.running) {
      entries.push({
        session: name,
        label: name,
        host: "(local)",
        reachable: true,
      });
    } else {
      entries.push({
        session: name,
        label: name,
        host: "(local)",
        reachable: false,
        error: "not running",
      });
    }
  }

  return entries;
}

/** Enumerate local + reachable-remote Herdr sessions for dashboard multi-session mode. */
export async function discoverAllSessions(
  projectPath: string,
  options: DashboardFetchOptions = {}
): Promise<DashboardSessionCatalog> {
  const config = discoverHerdrProjectConfig(projectPath);
  if (!config?.enabled) return buildEmptySessionCatalog();

  const errors: string[] = [];
  const entries = discoverLocalSessionEntries(errors);

  const full = { ...config, projectPath };
  const doc = loadOrchestratorDocument(config.sourcePath ?? null);
  const orchConfig = resolveOrchestratorConfig(full, doc);
  const remoteHosts = orchConfig.remoteHosts;

  const hostFilter = options.host?.trim() || undefined;
  const domain = options.domain?.trim() || undefined;
  const domainMembers = domain ? new Set(orchConfig.domains[domain]?.hosts || []) : null;

  let hostsToScan = hostFilter
    ? Object.fromEntries(Object.entries(remoteHosts).filter(([k]) => k === hostFilter))
    : domain
      ? Object.fromEntries(Object.entries(remoteHosts).filter(([k]) => domainMembers?.has(k)))
      : remoteHosts;

  if (options.reachableRemoteHosts !== undefined) {
    const reachable = new Set(options.reachableRemoteHosts);
    hostsToScan = Object.fromEntries(
      Object.entries(hostsToScan).filter(([label]) => reachable.has(label))
    );
  }

  if (Object.keys(hostsToScan).length > 0) {
    const remoteDiscovered = await discoverRemoteSessions(hostsToScan, orchConfig.remoteDefaults);
    errors.push(...remoteDiscovered.errors.map((row) => row.message));

    for (const rs of remoteDiscovered.sessions) {
      const running = rs.status === "running";
      entries.push({
        session: rs.sessionName,
        label: rs.sessionName,
        host: rs.host,
        reachable: running,
        ...(running ? {} : { error: "not running" }),
      });
    }
  } else if (hostFilter) {
    errors.push(`host "${hostFilter}" not configured`);
  }

  return finalizeSessionCatalog(entries, errors);
}

export async function withDashboardSessionTimeout<T>(
  label: string,
  run: () => Promise<T>,
  timeoutMs = DASHBOARD_SESSION_FETCH_TIMEOUT_MS
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let finished = false;
  let value: T | undefined;
  let failure: string | undefined;

  void (async () => {
    try {
      value = await run();
    } catch (error: unknown) {
      failure = error instanceof Error ? error.message : Bun.inspect(error);
    } finally {
      finished = true;
    }
  })();

  const deadline = Date.now() + timeoutMs;
  while (!finished && Date.now() < deadline) {
    await Bun.sleep(25);
  }

  if (!finished) {
    return { ok: false, error: `${label} timed out after ${timeoutMs}ms` };
  }
  if (failure !== undefined) {
    return { ok: false, error: failure };
  }
  return { ok: true, value: value as T };
}
