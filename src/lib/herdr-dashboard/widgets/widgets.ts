/**
 * herdr-dashboard/widgets/widgets.ts — Session-scoped dashboard widget router + cache.
 */

import { TtlCache } from "../../cache.ts";
import type { DashboardMetaDiscovery } from "../discovery/meta.ts";
import {
  fetchDashboardGitWidget,
  GIT_WIDGET_WORKSPACE_SCOPE,
  type DashboardGitWidgetFetchOptions,
  type DashboardGitWidgetResponse,
  type GitWidgetDeps,
} from "./git.ts";
import {
  fetchDashboardLogsWidget,
  type DashboardLogsWidgetFetchOptions,
  type DashboardLogsWidgetResponse,
  type LogsWidgetDeps,
} from "./logs.ts";
import {
  fetchDashboardProcessesWidget,
  PROCESSES_WIDGET_WORKSPACE_SCOPE,
  type DashboardProcessesWidgetResponse,
  type ProcessesWidgetDeps,
} from "./processes.ts";
import { dashboardWidgetSessionLabel } from "./session.ts";

export {
  dashboardWidgetSessionLabel,
  findDashboardWidgetSessionEntry,
  resolveDashboardWidgetSession,
} from "./session.ts";
export {
  LOGS_WIDGET_DEFAULT_LINES,
  LOGS_WIDGET_MAX_LINES,
  type DashboardLogsWidgetResponse,
} from "./logs.ts";
export {
  GIT_WIDGET_DEFAULT_COMMITS,
  GIT_WIDGET_MAX_COMMITS,
  GIT_WIDGET_WORKSPACE_SCOPE,
  type DashboardGitWidgetData,
  type DashboardGitWidgetResponse,
} from "./git.ts";
export {
  PROCESSES_WIDGET_WORKSPACE_SCOPE,
  type DashboardProcessesPaneRow,
  type DashboardProcessesWidgetData,
  type DashboardProcessesWidgetResponse,
} from "./processes.ts";

export const DASHBOARD_WIDGET_IDS = ["logs", "processes", "git"] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

export interface DashboardWidgetFetchOptions
  extends DashboardLogsWidgetFetchOptions, DashboardGitWidgetFetchOptions {
  /** Herdr session name; omitted or empty = primary socket. */
  session?: string;
  /** Session catalog from discovery meta (for reachability + host routing). */
  catalog?: DashboardMetaDiscovery["sessionCatalog"];
}

export interface DashboardWidgetStubPayload {
  ok: false;
  widget: DashboardWidgetId;
  session: string;
  sessionLabel: string;
  available: false;
  message: string;
  fetchedAt?: string;
}

export type DashboardWidgetResponse =
  | DashboardProcessesWidgetResponse
  | DashboardLogsWidgetResponse
  | DashboardGitWidgetResponse
  | DashboardWidgetStubPayload;

export interface DashboardWidgetRuntime {
  discovery: DashboardMetaDiscovery;
  ttlMs: number;
  cache?: TtlCache<DashboardWidgetResponse>;
  processesDeps?: Partial<ProcessesWidgetDeps>;
  logsDeps?: Partial<LogsWidgetDeps>;
  gitDeps?: Partial<GitWidgetDeps>;
}

export function buildDashboardWidgetCacheKey(
  widget: DashboardWidgetId,
  projectPath: string,
  session: string,
  workspaceScope: string = PROCESSES_WIDGET_WORKSPACE_SCOPE
): string {
  return `${widget}|${projectPath}|${session.trim()}|${workspaceScope}`;
}

async function getWidgetCached(
  cache: TtlCache<DashboardWidgetResponse>,
  key: string,
  compute: () => Promise<DashboardWidgetResponse>
): Promise<DashboardWidgetResponse> {
  const peek = cache.peek(key);
  if (peek && !peek.stale) return peek.value;
  if (peek?.stale) {
    void (async () => {
      cache.set(key, await compute());
    })();
    return peek.value;
  }
  const value = await compute();
  cache.set(key, value);
  return value;
}

/** Route widget fetch — processes, logs, and git live. */
export async function fetchDashboardWidget(
  widget: DashboardWidgetId,
  projectPath: string,
  options: DashboardWidgetFetchOptions = {},
  runtime?: DashboardWidgetRuntime
): Promise<DashboardWidgetResponse> {
  const session = options.session?.trim() ?? "";
  const catalog = options.catalog ?? runtime?.discovery.sessionCatalog;

  if (widget === "processes") {
    const compute = () =>
      fetchDashboardProcessesWidget(projectPath, { session, catalog }, runtime?.processesDeps);

    if (runtime?.cache) {
      const key = buildDashboardWidgetCacheKey("processes", projectPath, session);
      return getWidgetCached(runtime.cache, key, compute);
    }
    return compute();
  }

  if (widget === "logs") {
    return fetchDashboardLogsWidget(
      projectPath,
      {
        session,
        catalog,
        paneId: options.paneId,
        lines: options.lines,
        since: options.since,
      },
      runtime?.logsDeps
    );
  }

  if (widget === "git") {
    const compute = () =>
      fetchDashboardGitWidget(
        projectPath,
        { session, catalog, commits: options.commits },
        runtime?.gitDeps
      );

    if (runtime?.cache) {
      const key = buildDashboardWidgetCacheKey(
        "git",
        projectPath,
        session,
        GIT_WIDGET_WORKSPACE_SCOPE
      );
      return getWidgetCached(runtime.cache, key, compute);
    }
    return compute();
  }

  return fetchDashboardWidgetStub(widget, { session });
}

export function isDashboardWidgetId(value: string): value is DashboardWidgetId {
  return (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value);
}

/** Placeholder response for unimplemented widget ids. */
export function fetchDashboardWidgetStub(
  widget: DashboardWidgetId,
  options: DashboardWidgetFetchOptions = {}
): DashboardWidgetStubPayload {
  const session = options.session?.trim() ?? "";
  return {
    ok: false,
    widget,
    session,
    sessionLabel: dashboardWidgetSessionLabel(session),
    available: false,
    message: `widget "${widget}" not implemented`,
    fetchedAt: new Date().toISOString(),
  };
}
