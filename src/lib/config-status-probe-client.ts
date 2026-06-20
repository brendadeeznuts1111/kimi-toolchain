/**
 * Serve-probe client for ConfigStatusReport — shared by portal/Herdr convergence.
 */

import type { ConfigStatusReport } from "./config-status.ts";
import {
  DEFAULT_PROBE_SERVER_HOST,
  DEFAULT_PROBE_SERVER_PORT,
  PROBE_SERVER_HOST_ENV,
  PROBE_SERVER_PORT_ENV,
} from "./card-probe-server.ts";

export const CONFIG_STATUS_PROBE_ROUTE = "/api/config-status";

/** Resolve serve-probe config-status URL (env overrides [doctor.probe] defaults). */
export function resolveConfigStatusProbeUrl(options?: {
  host?: string;
  port?: number;
  path?: string;
}): string {
  const host = Bun.env[PROBE_SERVER_HOST_ENV] ?? options?.host ?? DEFAULT_PROBE_SERVER_HOST;
  const port = Number(Bun.env[PROBE_SERVER_PORT_ENV] ?? options?.port ?? DEFAULT_PROBE_SERVER_PORT);
  const path = options?.path ?? CONFIG_STATUS_PROBE_ROUTE;
  return `http://${host}:${port}${path}`;
}

interface ConfigStatusProbeResponse {
  ok: boolean;
  configStatus: ConfigStatusReport | null;
  fetchedAt: string | null;
}

/** Fetch cached ConfigStatusReport from kimi-doctor --serve-probe. */
export async function fetchConfigStatusProbeEnvelope(
  baseUrl?: string
): Promise<ConfigStatusReport> {
  const url = baseUrl ?? resolveConfigStatusProbeUrl();
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`config-status probe ${res.status} ${res.statusText} (${url})`);
  }
  const body = (await res.json()) as ConfigStatusProbeResponse;
  if (!body.ok || !body.configStatus) {
    throw new Error(`config-status probe returned empty report (${url})`);
  }
  return body.configStatus;
}
