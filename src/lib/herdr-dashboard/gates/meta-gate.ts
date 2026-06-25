/**
 * herdr-dashboard/gates/meta-gate.ts — Assert /api/meta discovery contract (workspace resolution).
 */

import { DEFAULT_DASHBOARD_PORT } from "../data/data.ts";
import type { DashboardMetaDiscovery } from "../discovery/meta.ts";
import type { WorkspaceIdResolution } from "../../herdr-workspace-match.ts";

export const DASHBOARD_META_VALID_RESOLUTIONS = [
  "focused_cwd",
  "cwd",
  "pane_count",
  "lexicographic",
  "single",
  "none",
] as const satisfies readonly WorkspaceIdResolution[];

export type DashboardMetaGateFailureCode =
  | "unreachable"
  | "invalid_json"
  | "missing_discovery"
  | "invalid_resolution"
  | "invalid_candidate_count"
  | "missing_remote_hosts"
  | "remote_hosts_unreachable";

export interface DashboardMetaGateFailure {
  code: DashboardMetaGateFailureCode;
  message: string;
  /** Second-line detail for human output (strict remote host failures). */
  detail?: string;
  actual?: unknown;
  expected?: unknown;
}

export interface DashboardMetaGateResult {
  ok: boolean;
  url: string;
  strict?: boolean;
  discovery?: DashboardMetaDiscovery;
  failure?: DashboardMetaGateFailure;
}

export interface DashboardMetaApiResponse {
  ok?: boolean;
  discovery?: DashboardMetaDiscovery;
}

export interface ResolveDashboardMetaUrlOptions {
  url?: string;
  hostname?: string;
  port?: number;
}

export interface ValidateDashboardMetaDiscoveryOptions {
  /** When true, require all configured remote hosts to be reachable. */
  strict?: boolean;
}

export interface RunDashboardMetaGateOptions extends ResolveDashboardMetaUrlOptions {
  timeoutMs?: number;
  strict?: boolean;
}

/** Resolve dashboard base URL for meta gate (HERDR_DASHBOARD_URL env wins). */
export function resolveDashboardMetaUrl(options: ResolveDashboardMetaUrlOptions = {}): string {
  const fromEnv = (Bun.env.HERDR_DASHBOARD_URL ?? "").trim();
  if (options.url?.trim()) return normalizeDashboardBaseUrl(options.url.trim());
  if (fromEnv) return normalizeDashboardBaseUrl(fromEnv);
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? DEFAULT_DASHBOARD_PORT;
  return `http://${hostname}:${port}/`;
}

export function normalizeDashboardBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return resolveDashboardMetaUrl();
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export function isValidWorkspaceIdResolution(value: unknown): value is WorkspaceIdResolution {
  return (
    typeof value === "string" &&
    (DASHBOARD_META_VALID_RESOLUTIONS as readonly string[]).includes(value)
  );
}

function isRemoteHostsBlock(
  value: unknown
): value is NonNullable<DashboardMetaDiscovery["remoteHosts"]> {
  return Boolean(value && typeof value === "object");
}

/**
 * Configured remote host count — prefers `discovery.remoteHosts.configured`.
 * Falls back to deprecated `remoteHostsConfigured` only when the block is missing (Phase 3 removal).
 */
export function resolveRemoteHostsConfigured(row: DashboardMetaDiscovery): number {
  if (isRemoteHostsBlock(row.remoteHosts) && typeof row.remoteHosts.configured === "number") {
    return row.remoteHosts.configured;
  }
  const legacy = row.remoteHostsConfigured;
  if (typeof legacy === "number" && Number.isFinite(legacy) && legacy >= 0) {
    return legacy;
  }
  return 0;
}

function resolveRemoteHostsReachable(row: DashboardMetaDiscovery): number {
  if (isRemoteHostsBlock(row.remoteHosts) && typeof row.remoteHosts.reachable === "number") {
    return row.remoteHosts.reachable;
  }
  return 0;
}

/** Human status line: workspace · resolution · candidate count. */
export function formatDashboardMetaDiscoveryStatusLine(discovery: DashboardMetaDiscovery): string {
  return `workspace ${discovery.workspaceId ?? "—"} · ${discovery.workspaceIdResolution} · ${discovery.workspaceCandidateCount} candidate(s)`;
}

function formatRemoteHostsFailureDetail(
  configured: number,
  reachable: number,
  hosts: DashboardMetaDiscovery["remoteHosts"]["hosts"]
): string {
  if (hosts.length === 0) {
    return `remoteHosts: ${reachable}/${configured} reachable (hosts[] empty — probe results missing)`;
  }
  const unreachable = hosts.filter((host) => !host.reachable);
  const parts = unreachable.map((host) => `${host.label}: ${host.error ?? "unreachable"}`);
  return `remoteHosts: ${reachable}/${configured} reachable (${parts.join(", ")})`;
}

/**
 * Strict mode: all configured remote hosts must be reachable.
 * `configured === 0` passes. Empty `hosts[]` with `configured > 0` fails (probe gap).
 */
export function validateRemoteHostsReachable(
  discovery: DashboardMetaDiscovery
): DashboardMetaGateFailure | null {
  const configured = resolveRemoteHostsConfigured(discovery);
  if (configured === 0) return null;

  if (!isRemoteHostsBlock(discovery.remoteHosts)) {
    return {
      code: "missing_remote_hosts",
      message: "meta.discovery.remoteHosts missing (configured remote hosts expected)",
      detail: `remoteHosts: 0/${configured} reachable (remoteHosts block missing)`,
    };
  }

  const reachable = resolveRemoteHostsReachable(discovery);
  if (reachable >= configured) return null;

  const hosts = discovery.remoteHosts.hosts ?? [];
  return {
    code: "remote_hosts_unreachable",
    message: `remoteHosts: ${reachable}/${configured} reachable`,
    detail: formatRemoteHostsFailureDetail(configured, reachable, hosts),
  };
}

/** Validate discovery block shape from GET /api/meta. */
export function validateDashboardMetaDiscovery(
  discovery: unknown,
  options: ValidateDashboardMetaDiscoveryOptions = {}
): DashboardMetaGateFailure | null {
  if (!discovery || typeof discovery !== "object") {
    return {
      code: "missing_discovery",
      message: "meta.discovery missing",
    };
  }

  const row = discovery as DashboardMetaDiscovery;
  const resolution = row.workspaceIdResolution;

  if (!isValidWorkspaceIdResolution(resolution)) {
    return {
      code: "invalid_resolution",
      message: "meta.discovery.workspaceIdResolution invalid or missing",
      actual: resolution,
      expected: DASHBOARD_META_VALID_RESOLUTIONS,
    };
  }

  const count = row.workspaceCandidateCount;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return {
      code: "invalid_candidate_count",
      message: "meta.discovery.workspaceCandidateCount must be a number >= 0",
      actual: count,
    };
  }

  if (options.strict) {
    return validateRemoteHostsReachable(row);
  }

  return null;
}

export async function fetchDashboardMeta(
  url = resolveDashboardMetaUrl(),
  timeoutMs = 5_000
): Promise<
  { ok: true; meta: DashboardMetaApiResponse } | { ok: false; failure: DashboardMetaGateFailure }
> {
  const metaUrl = `${normalizeDashboardBaseUrl(url)}api/meta`;
  try {
    const response = await fetch(metaUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return {
        ok: false,
        failure: {
          code: "unreachable",
          message: `GET ${metaUrl} returned ${response.status}`,
        },
      };
    }
    let meta: DashboardMetaApiResponse;
    try {
      meta = (await response.json()) as DashboardMetaApiResponse;
    } catch {
      return {
        ok: false,
        failure: {
          code: "invalid_json",
          message: `GET ${metaUrl} returned non-JSON body`,
        },
      };
    }
    if (!meta || typeof meta !== "object") {
      return {
        ok: false,
        failure: {
          code: "invalid_json",
          message: `GET ${metaUrl} returned non-JSON body`,
        },
      };
    }
    return { ok: true, meta };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : Bun.inspect(error);
    return {
      ok: false,
      failure: {
        code: "unreachable",
        message: `GET ${metaUrl} failed: ${message}`,
      },
    };
  }
}

/** One HTTP call to /api/meta; fails on contract break or unreachable dashboard. */
export async function runDashboardMetaGate(
  options: RunDashboardMetaGateOptions = {}
): Promise<DashboardMetaGateResult> {
  const { strict = false, timeoutMs, ...urlOptions } = options;
  const url = resolveDashboardMetaUrl(urlOptions);
  const fetched = await fetchDashboardMeta(url, timeoutMs);
  if (!fetched.ok) {
    return { ok: false, url, strict, failure: fetched.failure };
  }

  const failure = validateDashboardMetaDiscovery(fetched.meta.discovery, { strict });
  if (failure) {
    return {
      ok: false,
      url,
      strict,
      discovery: fetched.meta.discovery,
      failure,
    };
  }

  return {
    ok: true,
    url,
    strict,
    discovery: fetched.meta.discovery,
  };
}

export {
  ARTIFACT_PORTAL_CONTRACT_PATH,
  ARTIFACT_PORTAL_GATE,
  PORTAL_BENCHMARK_DIAGNOSTICS_TYPE,
  pullBenchmarkEnvelopeAndRegister,
  registerPortalArtifact,
  type PortalArtifactInput,
  type PortalArtifactRecord,
  type PullBenchmarkEnvelopeOptions,
} from "../../artifact-portal.ts";
