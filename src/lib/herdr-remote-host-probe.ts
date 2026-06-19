/**
 * herdr-remote-host-probe.ts — Lightweight SSH reachability probe for remote Herdr hosts.
 */

import { TOML } from "bun";
import { readText } from "./bun-io.ts";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import {
  normalizeRemoteHostConfig,
  resolveOrchestratorConfig,
  type RemoteDefaults,
  type RemoteHostConfig,
  type ResolvedRemoteHost,
} from "./herdr-orchestrator-config.ts";
import { friendlySshError, sshExec } from "./herdr-orchestrator.ts";

export const REMOTE_HOST_PROBE_TIMEOUT_MS = 5_000;

export interface RemoteHostProbeHost {
  label: string;
  reachable: boolean;
  version?: string;
  error?: string;
}

export interface DashboardRemoteHostsStatus {
  configured: number;
  reachable: number;
  hosts: RemoteHostProbeHost[];
}

export interface ProbeRemoteHostOptions {
  timeoutMs?: number;
}

function loadOrchestratorDocument(sourcePath: string | null): Record<string, unknown> | null {
  if (!sourcePath) return null;
  try {
    return TOML.parse(readText(sourcePath)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Parse first line of `herdr version` output (e.g. "herdr 0.9.4"). */
export function parseHerdrVersionOutput(output: string): string | undefined {
  const first = output.split("\n")[0]?.trim();
  if (!first) return undefined;
  const match = /^herdr\s+(.+)$/i.exec(first);
  return match?.[1]?.trim() ?? first;
}

export function buildEmptyRemoteHostsStatus(): DashboardRemoteHostsStatus {
  return { configured: 0, reachable: 0, hosts: [] };
}

export function buildRemoteHostsStatus(hosts: RemoteHostProbeHost[]): DashboardRemoteHostsStatus {
  const reachable = hosts.filter((host) => host.reachable).length;
  return {
    configured: hosts.length,
    reachable,
    hosts,
  };
}

/** SSH `herdr version` — sufficient for reachability without session enumeration. */
export async function probeRemoteHost(
  label: string,
  resolved: ResolvedRemoteHost,
  options: ProbeRemoteHostOptions = {}
): Promise<RemoteHostProbeHost> {
  const timeoutMs = options.timeoutMs ?? REMOTE_HOST_PROBE_TIMEOUT_MS;
  const probeResolved: ResolvedRemoteHost = { ...resolved, timeout: timeoutMs };
  const result = await sshExec(probeResolved, ["herdr", "version"]);
  if (!result.ok) {
    const output = result.output;
    const error =
      output.includes("command not found") || output.includes("not found")
        ? "herdr command not found on host"
        : friendlySshError(output, label);
    return { label, reachable: false, error };
  }
  return {
    label,
    reachable: true,
    version: parseHerdrVersionOutput(result.output),
  };
}

/** Parallel reachability batch — per-host timeout, fail open on individual errors. */
export async function probeRemoteHosts(
  remoteHosts: Record<string, string | RemoteHostConfig>,
  remoteDefaults?: RemoteDefaults,
  options: ProbeRemoteHostOptions = {}
): Promise<DashboardRemoteHostsStatus> {
  const labels = Object.keys(remoteHosts);
  if (labels.length === 0) return buildEmptyRemoteHostsStatus();

  const resolvedHosts = normalizeRemoteHostConfig(remoteHosts, remoteDefaults);
  const settled = await Promise.allSettled(
    labels.map(async (label) => {
      const resolved = resolvedHosts[label];
      if (!resolved) {
        return {
          label,
          reachable: false,
          error: "host config missing",
        } satisfies RemoteHostProbeHost;
      }
      return probeRemoteHost(label, resolved, options);
    })
  );

  const hosts: RemoteHostProbeHost[] = settled.map((entry, index) => {
    const label = labels[index] ?? "unknown";
    if (entry.status === "fulfilled") return entry.value;
    const message = entry.reason instanceof Error ? entry.reason.message : String(entry.reason);
    return { label, reachable: false, error: message };
  });

  return buildRemoteHostsStatus(hosts);
}

/** Probe remote hosts declared in the project's dx.config.toml [herdr.orchestrator]. */
export async function probeProjectRemoteHosts(
  projectPath: string,
  options: ProbeRemoteHostOptions = {}
): Promise<DashboardRemoteHostsStatus> {
  const config = discoverHerdrProjectConfig(projectPath);
  if (!config?.enabled) return buildEmptyRemoteHostsStatus();

  const full = { ...config, projectPath };
  const doc = loadOrchestratorDocument(config.sourcePath ?? null);
  const orchConfig = resolveOrchestratorConfig(full, doc);
  return probeRemoteHosts(orchConfig.remoteHosts, orchConfig.remoteDefaults, options);
}
