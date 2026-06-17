/**
 * herdr-dashboard-http3.ts — optional HTTP/3 (QUIC) transport for the dashboard server.
 *
 * HTTP/3 requires TLS. Configure certificate paths via:
 *   HERDR_DASHBOARD_TLS_CERT — PEM certificate file
 *   HERDR_DASHBOARD_TLS_KEY  — PEM private key file
 *
 * Enable HTTP/3 with HERDR_DASHBOARD_HTTP3=1 or the orchestrator `--http3` flag.
 * Falls back to plain HTTP/1.1 when certs are missing or HTTP/3 is unavailable.
 *
 * @see https://bun.sh/docs/runtime/http/server#http-3-quic
 */

import { pathExists } from "./bun-io.ts";
import { semverSatisfies } from "./bun-utils.ts";

export const HERDR_DASHBOARD_HTTP3_ENV = "HERDR_DASHBOARD_HTTP3";
export const HERDR_DASHBOARD_TLS_CERT_ENV = "HERDR_DASHBOARD_TLS_CERT";
export const HERDR_DASHBOARD_TLS_KEY_ENV = "HERDR_DASHBOARD_TLS_KEY";

/** Minimum Bun version with experimental Bun.serve http3 support. */
export const BUN_HTTP3_MIN_VERSION = "1.3.14";

/** True when this Bun runtime advertises experimental HTTP/3 in Bun.serve. */
export function bunHttp3ServeSupported(): boolean {
  return semverSatisfies(Bun.version, `>=${BUN_HTTP3_MIN_VERSION}`);
}

export interface DashboardTlsPaths {
  certPath: string;
  keyPath: string;
}

/** Resolve TLS material from explicit paths or HERDR_DASHBOARD_TLS_* env vars. */
export function resolveDashboardTlsPaths(overrides?: {
  certPath?: string;
  keyPath?: string;
}): DashboardTlsPaths | null {
  const certPath = (overrides?.certPath ?? Bun.env[HERDR_DASHBOARD_TLS_CERT_ENV] ?? "").trim();
  const keyPath = (overrides?.keyPath ?? Bun.env[HERDR_DASHBOARD_TLS_KEY_ENV] ?? "").trim();
  if (!certPath || !keyPath) return null;
  if (!pathExists(certPath) || !pathExists(keyPath)) return null;
  return { certPath, keyPath };
}

/** True when HTTP/3 was requested via CLI option or HERDR_DASHBOARD_HTTP3 env. */
export function dashboardHttp3Requested(option?: boolean): boolean {
  if (option === true) return true;
  if (option === false) return false;
  const raw = (Bun.env[HERDR_DASHBOARD_HTTP3_ENV] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export interface DashboardServeTransport {
  /** Whether the active listener uses TLS (HTTPS). */
  tls: boolean;
  /** Whether HTTP/3 (QUIC) is enabled on the listener. */
  http3: boolean;
  /** Why HTTP/3/TLS was not enabled when it was requested. */
  fallbackReason?: string;
}

export interface DashboardServeTlsOptions {
  tls: {
    cert: ReturnType<typeof Bun.file>;
    key: ReturnType<typeof Bun.file>;
  };
  http3: true;
}

export interface ResolveDashboardServeTransportInput {
  http3?: boolean;
  certPath?: string;
  keyPath?: string;
}

export interface ResolveDashboardServeTransportResult {
  serveOptions: DashboardServeTlsOptions | Record<string, never>;
  transport: DashboardServeTransport;
}

/** Build Bun.serve TLS/HTTP3 options with graceful HTTP/1.1 fallback. */
export function resolveDashboardServeTransport(
  input: ResolveDashboardServeTransportInput = {}
): ResolveDashboardServeTransportResult {
  const requested = dashboardHttp3Requested(input.http3);
  if (!requested) {
    return {
      serveOptions: {},
      transport: { tls: false, http3: false },
    };
  }

  if (!bunHttp3ServeSupported()) {
    return {
      serveOptions: {},
      transport: {
        tls: false,
        http3: false,
        fallbackReason: `Bun ${BUN_HTTP3_MIN_VERSION}+ required for HTTP/3`,
      },
    };
  }

  const paths = resolveDashboardTlsPaths({
    certPath: input.certPath,
    keyPath: input.keyPath,
  });
  if (!paths) {
    return {
      serveOptions: {},
      transport: {
        tls: false,
        http3: false,
        fallbackReason: `set ${HERDR_DASHBOARD_TLS_CERT_ENV} and ${HERDR_DASHBOARD_TLS_KEY_ENV}`,
      },
    };
  }

  return {
    serveOptions: {
      tls: {
        cert: Bun.file(paths.certPath),
        key: Bun.file(paths.keyPath),
      },
      http3: true,
    },
    transport: { tls: true, http3: true },
  };
}

/** URL scheme for the active dashboard transport. */
export function dashboardServeScheme(transport: DashboardServeTransport): "http" | "https" {
  return transport.tls ? "https" : "http";
}
