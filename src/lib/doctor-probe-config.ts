/**
 * Read `[doctor]` / `[doctor.probe]` from project dx.config.toml.
 */

import {
  DEFAULT_PROBE_SERVER_HOST,
  DEFAULT_PROBE_SERVER_PORT,
  PROBE_SERVER_HOST_ENV,
  PROBE_SERVER_PORT_ENV,
} from "./card-probe-server.ts";
import { readTomlDocument, resolveProjectConfigPath } from "./dx-config-parse.ts";

export interface DoctorTab {
  name: string;
  command: string;
}

export interface DoctorProbeConfig {
  host?: string;
  port?: number;
  /** Periodic card refresh interval in milliseconds. */
  intervalMs?: number;
}

export interface DoctorConfig {
  tabs: DoctorTab[];
  probe: DoctorProbeConfig;
}

function asDoctorTable(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseDoctorTabRow(value: unknown): DoctorTab | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const name =
    typeof row.name === "string"
      ? row.name.trim()
      : typeof row.label === "string"
        ? row.label.trim()
        : "";
  const command = typeof row.command === "string" ? row.command.trim() : "";
  if (!name || !command) return null;
  return { name, command };
}

/** Parse `[doctor].tabs` inline array or legacy `[[doctor.tabs]]` rows. */
export function parseDoctorTabs(doctor: Record<string, unknown> | null): DoctorTab[] {
  if (!doctor) return [];

  const inline = Array.isArray(doctor.tabs)
    ? doctor.tabs.map(parseDoctorTabRow).filter((tab): tab is DoctorTab => tab != null)
    : [];

  if (inline.length > 0) return inline;

  // Legacy: TOML may surface repeated [[doctor.tabs]] under doctor.tabs as array too.
  return inline;
}

function parseDoctorProbeTable(doctor: Record<string, unknown> | null): DoctorProbeConfig {
  if (!doctor) return {};
  const probe = doctor.probe;
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) return {};
  const row = probe as Record<string, unknown>;

  const config: DoctorProbeConfig = {};
  if (typeof row.host === "string" && row.host.trim()) {
    config.host = row.host.trim();
  }
  if (typeof row.port === "number" && Number.isFinite(row.port) && row.port > 0) {
    config.port = Math.floor(row.port);
  }
  const interval = row.interval ?? row.intervalMs;
  if (typeof interval === "number" && Number.isFinite(interval) && interval > 0) {
    config.intervalMs = Math.floor(interval);
  }
  return config;
}

/** Load doctor tabs and serve-probe defaults from `dx.config.toml`. */
export async function readDoctorConfig(projectRoot: string): Promise<DoctorConfig> {
  const configPath = resolveProjectConfigPath(projectRoot);
  if (!configPath) return { tabs: [], probe: {} };

  const doc = await readTomlDocument(configPath);
  const doctor = asDoctorTable(doc.doctor);
  return {
    tabs: parseDoctorTabs(doctor),
    probe: parseDoctorProbeTable(doctor),
  };
}

/** Load serve-probe host/port/interval from `dx.config.toml` `[doctor.probe]`. */
export async function readDoctorProbeConfig(projectRoot: string): Promise<DoctorProbeConfig> {
  const config = await readDoctorConfig(projectRoot);
  return config.probe;
}

/** Resolve bind host/port (env overrides `[doctor.probe]`, then runtime default). */
export function resolveProbeServerBind(probe: DoctorProbeConfig = {}): {
  host: string;
  port: number;
} {
  const host = Bun.env[PROBE_SERVER_HOST_ENV] ?? probe.host ?? DEFAULT_PROBE_SERVER_HOST;
  const port = Number(Bun.env[PROBE_SERVER_PORT_ENV] ?? probe.port ?? DEFAULT_PROBE_SERVER_PORT);
  return { host, port };
}

/** Resolve loopback serve-probe base URL (env → TOML → runtime default). */
export async function resolveProbeServerUrl(projectRoot: string): Promise<string> {
  const probe = await readDoctorProbeConfig(projectRoot);
  const { host, port } = resolveProbeServerBind(probe);
  return `http://${host}:${port}`;
}
