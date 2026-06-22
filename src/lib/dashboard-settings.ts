/**
 * Dashboard Contract v1.0 — unified settings SSOT for examples/dashboard.
 *
 * Merge order: environment → dx.config.toml → canonical defaults.
 * Client URL params (?canvas=, ?example=, identity) are applied in the browser.
 */

import { GATE_LEVEL_PRUNE_MS, type GateLevel } from "../gates/types.ts";
import {
  DEFAULT_PROBE_SERVER_HOST,
  PROBE_SERVER_HOST_ENV,
  PROBE_SERVER_PORT_ENV,
} from "./card-probe-server.ts";
import { ARTIFACT_IDENTITY_MAX_LEN, DEFAULT_ARTIFACT_MAX_AGE_MS } from "./artifact-store.ts";
import { buildDashboardCardRegistry } from "./dashboard-card-registry.ts";
import { CANONICAL_DASHBOARD_PORT } from "./dashboard-constants.ts";
import { readTomlDocument, resolveProjectConfigPath } from "./dx-config-parse.ts";
import { readDoctorProbeConfig } from "./doctor-probe-config.ts";

/** Herdr / kimi-dashboard canonical listen port (Dashboard Contract v1.0). */
export { CANONICAL_DASHBOARD_PORT };

/** Direct `bun run src/index.ts` fallback — converged to canonical 5678 (Dashboard Contract v1.0). */
export const LEGACY_DIRECT_DASHBOARD_PORT = 5678;

export const DASHBOARD_SETTINGS_SCHEMA_VERSION = 1 as const;

export type DashboardSettingsSource =
  | "env"
  | "cli"
  | "dx.config"
  | "request"
  | "canonical"
  | "default";

export interface DashboardConfig {
  port?: number;
}

export interface DashboardSettings {
  schemaVersion: typeof DASHBOARD_SETTINGS_SCHEMA_VERSION;
  port: number;
  /** Resolved listen URL for deep links and PATH header. */
  dashboardUrl: string;
  probeHost: string;
  probePort: number;
  artifactRoot: string;
  defaultCanvas: string | null;
  retentionMs: Record<string, number>;
  identityFieldMaxLen: number;
  cardCount: number;
  canvasLinkedCount: number;
  canvasOrphanCount: number;
  canonicalPort: number;
  legacyDirectPort: number;
  sources: {
    port: DashboardSettingsSource;
    probeHost: DashboardSettingsSource;
    probePort: DashboardSettingsSource;
    artifactRoot: DashboardSettingsSource;
    identityFieldMaxLen: DashboardSettingsSource;
  };
}

export function resolveDashboardProjectRoot(moduleDir = import.meta.dir): string {
  const override = Bun.env.KIMI_ARTIFACT_PROJECT_ROOT?.trim();
  if (override) return override;
  if (moduleDir.includes("kimi-toolchain")) {
    return moduleDir.split("kimi-toolchain")[0] + "kimi-toolchain";
  }
  return process.cwd();
}

function retentionMsPayload(): Record<string, number> {
  return Object.fromEntries(
    (Object.entries(GATE_LEVEL_PRUNE_MS) as unknown as Array<[GateLevel, number]>).map(
      ([level, ms]) => [String(level), ms]
    )
  ) as Record<string, number>;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function portFromRequestUrl(url: URL | undefined): number | undefined {
  if (!url?.port) return undefined;
  const value = Number(url.port);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

/** Load `[dashboard].port` from project `dx.config.toml`. */
export async function readDashboardConfig(projectRoot: string): Promise<DashboardConfig> {
  const configPath = resolveProjectConfigPath(projectRoot);
  if (!configPath) return {};

  const doc = await readTomlDocument(configPath);
  const dashboard = doc.dashboard;
  if (!dashboard || typeof dashboard !== "object" || Array.isArray(dashboard)) return {};

  const row = dashboard as Record<string, unknown>;
  if (typeof row.port === "number" && Number.isFinite(row.port) && row.port > 0) {
    return { port: Math.floor(row.port) };
  }
  return {};
}

/** Parse `--port` / `-p` from process argv (startup precedence below `PORT` env). */
export function parseDashboardCliPort(argv: string[] = Bun.argv): number | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--port=")) {
      return parsePositiveInt(arg.slice("--port=".length));
    }
    if ((arg === "--port" || arg === "-p") && argv[i + 1]) {
      return parsePositiveInt(argv[i + 1]);
    }
  }
  return undefined;
}

export interface ResolveDashboardListenPortOptions {
  requestUrl?: URL;
  cliPort?: number;
  configPort?: number;
}

/** Resolve dashboard listen port (request → PORT env → CLI → [dashboard].port → 5678). */
export function resolveDashboardListenPort(options: ResolveDashboardListenPortOptions = {}): {
  port: number;
  source: DashboardSettingsSource;
} {
  const fromRequest = portFromRequestUrl(options.requestUrl);
  if (fromRequest !== undefined) {
    return { port: fromRequest, source: "request" };
  }
  const fromEnv = parsePositiveInt(Bun.env.PORT);
  if (fromEnv !== undefined) {
    return { port: fromEnv, source: "env" };
  }
  if (options.cliPort !== undefined) {
    return { port: options.cliPort, source: "cli" };
  }
  if (options.configPort !== undefined) {
    return { port: options.configPort, source: "dx.config" };
  }
  return { port: CANONICAL_DASHBOARD_PORT, source: "canonical" };
}

/** Startup bind port — reads `[dashboard].port` when env/CLI unset. */
export async function resolveDashboardStartupPort(
  projectRoot: string,
  options: { cliPort?: number } = {}
): Promise<{ port: number; source: DashboardSettingsSource }> {
  const config = await readDashboardConfig(projectRoot);
  return resolveDashboardListenPort({ cliPort: options.cliPort, configPort: config.port });
}

/** Contract probe port: PROBE_SERVER_PORT → [doctor.probe].port → dashboard port. */
export async function resolveDashboardProbeBind(
  projectRoot: string,
  dashboardPort: number
): Promise<{
  host: string;
  port: number;
  sources: { host: DashboardSettingsSource; port: DashboardSettingsSource };
}> {
  const probe = await readDoctorProbeConfig(projectRoot);

  const envHost = Bun.env[PROBE_SERVER_HOST_ENV]?.trim();
  const host = envHost || probe.host || DEFAULT_PROBE_SERVER_HOST;
  const hostSource: DashboardSettingsSource = envHost
    ? "env"
    : probe.host
      ? "dx.config"
      : "default";

  const envProbe = parsePositiveInt(Bun.env[PROBE_SERVER_PORT_ENV]);
  if (envProbe !== undefined) {
    return { host, port: envProbe, sources: { host: hostSource, port: "env" } };
  }
  if (probe.port !== undefined) {
    return { host, port: probe.port, sources: { host: hostSource, port: "dx.config" } };
  }
  return { host, port: dashboardPort, sources: { host: hostSource, port: "canonical" } };
}

export function resolveDashboardArtifactRoot(projectRoot: string): {
  artifactRoot: string;
  source: DashboardSettingsSource;
} {
  const envRoot = Bun.env.KIMI_ARTIFACT_PROJECT_ROOT?.trim();
  if (envRoot) return { artifactRoot: envRoot, source: "env" };
  return { artifactRoot: projectRoot, source: "default" };
}

export function resolveDashboardIdentityFieldMaxLen(): {
  identityFieldMaxLen: number;
  source: DashboardSettingsSource;
} {
  const fromEnv = parsePositiveInt(Bun.env.ARTIFACT_IDENTITY_MAX_LEN);
  if (fromEnv !== undefined) {
    return { identityFieldMaxLen: fromEnv, source: "env" };
  }
  return { identityFieldMaxLen: ARTIFACT_IDENTITY_MAX_LEN, source: "default" };
}

/** Build settings payload for GET /api/settings. */
export async function resolveDashboardSettings(
  projectRoot: string,
  options: { requestUrl?: URL } = {}
): Promise<DashboardSettings> {
  const config = await readDashboardConfig(projectRoot);
  const { port, source: portSource } = resolveDashboardListenPort({
    requestUrl: options.requestUrl,
    configPort: config.port,
  });
  const probe = await resolveDashboardProbeBind(projectRoot, port);
  const artifact = resolveDashboardArtifactRoot(projectRoot);
  const identity = resolveDashboardIdentityFieldMaxLen();
  const registry = buildDashboardCardRegistry(projectRoot);
  const cardCount = registry.length;
  const canvasLinkedCount = registry.filter((card) => card.influencedBy.length > 0).length;
  const canvasOrphanCount = cardCount - canvasLinkedCount;

  return {
    schemaVersion: DASHBOARD_SETTINGS_SCHEMA_VERSION,
    port,
    dashboardUrl: `http://127.0.0.1:${port}/`,
    probeHost: probe.host,
    probePort: probe.port,
    artifactRoot: artifact.artifactRoot,
    defaultCanvas: null,
    retentionMs: retentionMsPayload(),
    identityFieldMaxLen: identity.identityFieldMaxLen,
    cardCount,
    canvasLinkedCount,
    canvasOrphanCount,
    canonicalPort: CANONICAL_DASHBOARD_PORT,
    legacyDirectPort: LEGACY_DIRECT_DASHBOARD_PORT,
    sources: {
      port: portSource,
      probeHost: probe.sources.host,
      probePort: probe.sources.port,
      artifactRoot: artifact.source,
      identityFieldMaxLen: identity.source,
    },
  };
}

/** Default L1 artifact max age (ms) — exposed for contract docs parity. */
export function defaultArtifactMaxAgeMs(): number {
  return DEFAULT_ARTIFACT_MAX_AGE_MS;
}

/** Alias for Dashboard Contract v1.0 loader (env → dx.config → canonical). */
export const loadDashboardConfig = resolveDashboardSettings;
