/**
 * Deep discovery for dx.config.toml — endpoints, handoff rules, gates,
 * remote hosts, probe coverage, and configuration gaps.
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import {
  CANONICAL_REFERENCES_PROBE_IDS,
  evaluateProbeHandoffCondition,
  isCanonicalReferencesProbeId,
} from "./canonical-references.ts";
import {
  evaluateFinishWorkProbeCondition,
  FINISH_WORK_PROBE_IDS,
  isFinishWorkProbeId,
} from "./finish-work-herdr.ts";
import {
  parseCondition,
  parseHandoffRuleEntry,
  parseHerdrOrchestratorSection,
  resolveTargetStrategy,
  type HandoffRule,
} from "./herdr-orchestrator-config.ts";
import {
  evaluateArtifactGraphProbeHandoffCondition,
  isArtifactGraphProbeId,
} from "./artifact-graph-health.ts";
import {
  evaluateBunInstallProbeHandoffCondition,
  isBunInstallProbeId,
} from "./bun-install-config.ts";
import { listTomlPropertyTablePaths } from "./toml-property-table.ts";
import { decomposeUrl, looksLikeAbsoluteUrl } from "./url-decomposer.ts";

export const DX_CONFIG_FILENAME = "dx.config.toml";

export interface DiscoveredEndpoint {
  name: string;
  url: string;
  line?: number;
  protocol?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  stack: "examples" | "herdr" | "external";
  duplicateNames: string[];
}

export interface DiscoveredHandoffRule {
  index: number;
  line?: number;
  fromWorkspace: string;
  fromAgent: string;
  condition: string;
  when: string[];
  toWorkspace: string;
  toAgent: string;
  targetStrategy: string;
  requirements: string[];
  probeIds: string[];
  conditionKind: "probe" | "status" | "report-when" | "unknown";
}

export interface DiscoveredRemoteHost {
  name: string;
  host: string;
  port?: number;
  user?: string;
  identityFile?: string;
  timeout?: number;
  hasHandoffRule: boolean;
}

export interface ProbeCoverageEntry {
  id: string;
  family: "finish-work" | "canonical-references";
  configured: boolean;
  ruleIndexes: number[];
}

export interface PortAlignmentReport {
  dashboardPort?: number;
  doctorProbePort?: number;
  examplesPorts: string[];
  herdrPorts: string[];
  aligned: boolean;
  notes: string[];
}

export interface LiveProbeResult {
  probeId: string;
  ruleIndexes: number[];
  ok: boolean;
  message: string;
}

export interface EndpointReachability {
  name: string;
  url: string;
  reachable: boolean;
  statusCode?: number;
  latencyMs: number;
  skipped: boolean;
  skipReason?: string;
  error?: string;
}

export interface DiscoverDxInventoryOptions {
  evaluateProbes?: boolean;
  probeEndpoints?: boolean;
  probeTimeoutMs?: number;
}

export interface DiscoverDxInventoryReport {
  configPath: string;
  endpointCount: number;
  uniqueUrlCount: number;
  duplicateUrlGroups: number;
  handoffRuleCount: number;
  finishWorkGateCount: number;
  remoteHostCount: number;
  configuredProbeCount: number;
  availableProbeCount: number;
  healthScore: number;
  registeredTomlTables: string[];
  portAlignment: PortAlignmentReport;
  liveProbes?: LiveProbeResult[];
  endpointReachability?: EndpointReachability[];
  orchestrator: {
    enabled: boolean;
    handoffFrom?: string;
    handoffTo?: string;
    contextOnIdle?: boolean;
    reviewerTab?: string;
    dashboardExamplesUrl?: string;
  };
  finishWork: {
    gates: string[];
    followUp?: string;
  };
  endpoints: DiscoveredEndpoint[];
  handoffRules: DiscoveredHandoffRule[];
  remoteHosts: DiscoveredRemoteHost[];
  probeCoverage: ProbeCoverageEntry[];
  unconfiguredProbes: string[];
  gaps: string[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function endpointLineNumbers(text: string): number[] {
  const lines: number[] = [];
  let inEndpoints = false;
  let blockIndex = 0;

  for (let i = 0; i < text.split("\n").length; i++) {
    const line = text.split("\n")[i]!;
    if (line.trim() === "[[endpoints]]") {
      inEndpoints = true;
      lines[blockIndex] = i + 1;
      blockIndex++;
      continue;
    }
    if (inEndpoints && line.startsWith("[[") && !line.includes("endpoints")) {
      inEndpoints = false;
    }
  }

  return lines;
}

function handoffRuleLineNumbers(text: string): number[] {
  const lines: number[] = [];
  const blockHeader = /^\s*\[\[herdr\.orchestrator\.handoff_rules\]\]\s*$/;
  for (let i = 0; i < text.split("\n").length; i++) {
    if (blockHeader.test(text.split("\n")[i]!)) lines.push(i + 1);
  }
  return lines;
}

function classifyEndpoint(_url: string, port?: string): DiscoveredEndpoint["stack"] {
  if (port === "5678") return "examples";
  if (port === "18412") return "herdr";
  return "external";
}

function flattenWhenObject(obj: unknown, prefix = ""): Array<[string, string | boolean | number]> {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const out: Array<[string, string | boolean | number]> = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenWhenObject(value, path));
    } else if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      typeof value === "number"
    ) {
      out.push([path, value]);
    }
  }
  return out;
}

function formatWhenClauses(rule: HandoffRule, rawWhen?: unknown): string[] {
  if (rule.when && rule.when.length > 0) {
    return rule.when.map((clause) => `${clause.path}=${JSON.stringify(clause.expected)}`);
  }
  return flattenWhenObject(rawWhen).map(([path, value]) => `${path}=${JSON.stringify(value)}`);
}

function collectProbeIds(rule: HandoffRule): string[] {
  const ids: string[] = [];
  const parsed = parseCondition(rule.condition);
  if (parsed?.kind === "probe") ids.push(parsed.probeId);
  return ids;
}

function buildRequirements(
  rule: HandoffRule,
  rawWhen?: unknown
): { requirements: string[]; kind: DiscoveredHandoffRule["conditionKind"] } {
  const requirements: string[] = [];
  const when = formatWhenClauses(rule, rawWhen);
  const parsed = parseCondition(rule.condition);

  if (when.length > 0) {
    requirements.push(...when.map((clause) => `when: ${clause}`));
  }

  if (parsed?.kind === "probe") {
    requirements.push(`probe: ${parsed.probeId}`);
    return { requirements, kind: when.length > 0 ? "probe" : "probe" };
  }

  if (parsed?.kind === "status") {
    const duration =
      parsed.minSeconds > 0 ? `${parsed.status} > ${parsed.minSeconds / 60}m` : parsed.status;
    requirements.push(`status: ${duration}`);
    return { requirements, kind: "status" };
  }

  if (rule.condition === "report:when" && when.length > 0) {
    return { requirements, kind: "report-when" };
  }

  if (requirements.length > 0) {
    return { requirements, kind: "report-when" };
  }

  requirements.push(`condition: ${rule.condition}`);
  return { requirements, kind: "unknown" };
}

function discoverEndpoints(parsed: Record<string, unknown>, text: string): DiscoveredEndpoint[] {
  const raw = parsed.endpoints;
  if (!Array.isArray(raw)) return [];

  const lines = endpointLineNumbers(text);
  const byUrl = new Map<string, string[]>();
  const items: DiscoveredEndpoint[] = [];

  for (let i = 0; i < raw.length; i++) {
    const entry = record(raw[i]);
    const name = typeof entry.name === "string" ? entry.name : `endpoint-${i + 1}`;
    const url = typeof entry.url === "string" ? entry.url : "";
    const names = byUrl.get(url) ?? [];
    names.push(name);
    byUrl.set(url, names);

    let protocol: string | undefined;
    let hostname: string | undefined;
    let port: string | undefined;
    let pathname: string | undefined;
    if (looksLikeAbsoluteUrl(url)) {
      const parts = decomposeUrl(url);
      protocol = parts.protocol;
      hostname = parts.hostname;
      port = parts.port === "—" ? undefined : parts.port;
      pathname = parts.pathname;
    }

    items.push({
      name,
      url,
      line: lines[i],
      protocol,
      hostname,
      port,
      pathname,
      stack: classifyEndpoint(url, port),
      duplicateNames: [],
    });
  }

  for (const item of items) {
    const names = byUrl.get(item.url) ?? [item.name];
    item.duplicateNames = names.filter((name) => name !== item.name);
  }

  return items;
}

function discoverHandoffRules(
  parsed: Record<string, unknown>,
  text: string
): DiscoveredHandoffRule[] {
  const herdr = record(parsed.herdr);
  const orchestrator = record(herdr.orchestrator);
  const rawRules = Array.isArray(orchestrator.handoff_rules) ? orchestrator.handoff_rules : [];
  const lines = handoffRuleLineNumbers(text);
  const discovered: DiscoveredHandoffRule[] = [];

  for (let i = 0; i < rawRules.length; i++) {
    const rawEntry = record(rawRules[i]);
    const rule = parseHandoffRuleEntry(rawRules[i]);
    if (!rule) continue;
    const rawWhen = rawEntry.when;
    const { requirements, kind } = buildRequirements(rule, rawWhen);
    discovered.push({
      index: i + 1,
      line: lines[i],
      fromWorkspace: rule.fromWorkspace,
      fromAgent: rule.fromAgent,
      condition: rule.condition,
      when: formatWhenClauses(rule, rawWhen),
      toWorkspace: rule.toWorkspace,
      toAgent: rule.toAgent,
      targetStrategy: resolveTargetStrategy(rule),
      requirements,
      probeIds: collectProbeIds(rule),
      conditionKind: kind,
    });
  }

  return discovered;
}

function discoverRemoteHosts(
  parsed: Record<string, unknown>,
  handoffRules: DiscoveredHandoffRule[]
): DiscoveredRemoteHost[] {
  const herdr = record(parsed.herdr);
  const orchestrator = record(herdr.orchestrator);
  const remoteHosts = record(orchestrator.remote_hosts);
  const hosts: DiscoveredRemoteHost[] = [];

  for (const [name, value] of Object.entries(remoteHosts)) {
    const hostEntry = record(value);
    const host = typeof hostEntry.host === "string" ? hostEntry.host : name;
    const referenced = handoffRules.some(
      (rule) => rule.toWorkspace === name || rule.fromWorkspace === name
    );
    hosts.push({
      name,
      host,
      port: typeof hostEntry.port === "number" ? hostEntry.port : undefined,
      user: typeof hostEntry.user === "string" ? hostEntry.user : undefined,
      identityFile: typeof hostEntry.identityFile === "string" ? hostEntry.identityFile : undefined,
      timeout: typeof hostEntry.timeout === "number" ? hostEntry.timeout : undefined,
      hasHandoffRule: referenced,
    });
  }

  return hosts;
}

function buildProbeCoverage(handoffRules: DiscoveredHandoffRule[]): ProbeCoverageEntry[] {
  const entries: ProbeCoverageEntry[] = [];

  for (const id of FINISH_WORK_PROBE_IDS) {
    const ruleIndexes = handoffRules
      .filter((rule) => rule.probeIds.includes(id))
      .map((rule) => rule.index);
    entries.push({
      id,
      family: "finish-work",
      configured: ruleIndexes.length > 0,
      ruleIndexes,
    });
  }

  for (const id of CANONICAL_REFERENCES_PROBE_IDS) {
    const probeId = `probe:${id}`;
    const ruleIndexes = handoffRules
      .filter((rule) => rule.probeIds.includes(probeId) || rule.probeIds.includes(id))
      .map((rule) => rule.index);
    entries.push({
      id,
      family: "canonical-references",
      configured: ruleIndexes.length > 0,
      ruleIndexes,
    });
  }

  return entries;
}

function collectGaps(input: {
  endpoints: DiscoveredEndpoint[];
  handoffRules: DiscoveredHandoffRule[];
  remoteHosts: DiscoveredRemoteHost[];
  probeCoverage: ProbeCoverageEntry[];
  parsed: Record<string, unknown>;
}): string[] {
  const gaps: string[] = [];

  const duplicateGroups = new Map<string, string[]>();
  for (const endpoint of input.endpoints) {
    const names = duplicateGroups.get(endpoint.url) ?? [];
    names.push(endpoint.name);
    duplicateGroups.set(endpoint.url, names);
  }
  for (const [url, names] of duplicateGroups) {
    if (names.length > 1) {
      gaps.push(`duplicate endpoint URL (${names.join(" = ")}) → ${url}`);
    }
  }

  const cloudflare = record(input.parsed.cloudflare);
  const mcp = record(cloudflare.mcp);
  const mcpUrl = typeof mcp.url === "string" ? mcp.url : undefined;
  const mcpEndpoint = input.endpoints.find((entry) => entry.name === "cloudflare-mcp");
  if (mcpUrl && mcpEndpoint && mcpUrl !== mcpEndpoint.url) {
    gaps.push(`cloudflare-mcp endpoint URL differs from [cloudflare.mcp].url`);
  }

  for (const host of input.remoteHosts) {
    if (!host.hasHandoffRule) {
      gaps.push(`remote host "${host.name}" has no handoff rule referencing it`);
    }
  }

  const hasStatusRule = input.handoffRules.some((rule) => rule.conditionKind === "status");
  if (!hasStatusRule) {
    gaps.push("no status-based handoff rules (done / idle / blocked)");
  }

  const hasWhenOnly = input.handoffRules.some(
    (rule) => rule.conditionKind === "report-when" && rule.probeIds.length === 0
  );
  if (!hasWhenOnly) {
    gaps.push("no when-only handoff rules (docs recommend finishWorkReport.handoffCandidate)");
  }

  const unconfigured = input.probeCoverage.filter((entry) => !entry.configured).length;
  if (unconfigured > 0) {
    gaps.push(`${unconfigured} probe IDs available but not wired in handoff_rules`);
  }

  const tripleGated = input.handoffRules.filter(
    (rule) => rule.probeIds.length > 0 && rule.when.length > 0
  );
  for (const rule of tripleGated) {
    gaps.push(
      `rule ${rule.index} ANDs probe + when (${rule.requirements.length} clauses) — easy to misread`
    );
  }

  return gaps;
}

function buildPortAlignment(
  parsed: Record<string, unknown>,
  endpoints: DiscoveredEndpoint[]
): PortAlignmentReport {
  const dashboard = record(parsed.dashboard);
  const doctor = record(parsed.doctor);
  const doctorProbe = record(doctor.probe);
  const dashboardPort = typeof dashboard.port === "number" ? dashboard.port : undefined;
  const doctorProbePort = typeof doctorProbe.port === "number" ? doctorProbe.port : undefined;
  const examplesPorts = [
    ...new Set(endpoints.filter((entry) => entry.stack === "examples").map((entry) => entry.port)),
  ].filter((port): port is string => Boolean(port));
  const herdrPorts = [
    ...new Set(endpoints.filter((entry) => entry.stack === "herdr").map((entry) => entry.port)),
  ].filter((port): port is string => Boolean(port));

  const notes: string[] = [];
  if (dashboardPort !== undefined && !examplesPorts.includes(String(dashboardPort))) {
    notes.push(`[dashboard].port=${dashboardPort} not reflected in examples endpoints`);
  }
  if (
    doctorProbePort !== undefined &&
    dashboardPort !== undefined &&
    doctorProbePort !== dashboardPort
  ) {
    notes.push(
      `[doctor.probe].port=${doctorProbePort} differs from [dashboard].port=${dashboardPort}`
    );
  }

  return {
    dashboardPort,
    doctorProbePort,
    examplesPorts,
    herdrPorts,
    aligned: notes.length === 0,
    notes,
  };
}

export function computeDxHealthScore(report: {
  gaps: string[];
  duplicateUrlGroups: number;
  configuredProbeCount: number;
  availableProbeCount: number;
  portAlignment: PortAlignmentReport;
  liveProbes?: LiveProbeResult[];
  endpointReachability?: EndpointReachability[];
}): number {
  let score = 100;
  score -= Math.min(40, report.gaps.length * 4);
  score -= report.duplicateUrlGroups * 3;
  if (!report.portAlignment.aligned) score -= 5;
  const missingProbes = report.availableProbeCount - report.configuredProbeCount;
  score -= Math.min(20, missingProbes * 2);
  if (report.liveProbes?.some((probe) => !probe.ok)) score -= 10;
  if (report.endpointReachability?.some((entry) => !entry.skipped && !entry.reachable)) score -= 8;
  return Math.max(0, Math.min(100, score));
}

async function evaluateConfiguredProbes(
  projectRoot: string,
  handoffRules: DiscoveredHandoffRule[]
): Promise<LiveProbeResult[]> {
  const byProbe = new Map<string, number[]>();
  for (const rule of handoffRules) {
    for (const probeId of rule.probeIds) {
      const indexes = byProbe.get(probeId) ?? [];
      indexes.push(rule.index);
      byProbe.set(probeId, indexes);
    }
  }

  const results: LiveProbeResult[] = [];
  for (const [probeId, ruleIndexes] of byProbe) {
    const normalized = probeId.startsWith("probe:") ? probeId.slice("probe:".length) : probeId;
    const evalResult = await evaluateHandoffProbeCondition(normalized, projectRoot);
    results.push({
      probeId,
      ruleIndexes,
      ok: evalResult.ok,
      message: evalResult.message,
    });
  }

  return results.sort((left, right) => left.probeId.localeCompare(right.probeId));
}

function isLocalHttpEndpoint(endpoint: DiscoveredEndpoint): boolean {
  return (
    endpoint.protocol === "http:" &&
    (endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost")
  );
}

async function probeEndpointReachability(
  endpoints: DiscoveredEndpoint[],
  timeoutMs: number
): Promise<EndpointReachability[]> {
  const results: EndpointReachability[] = [];

  for (const endpoint of endpoints) {
    if (!isLocalHttpEndpoint(endpoint)) {
      results.push({
        name: endpoint.name,
        url: endpoint.url,
        reachable: false,
        latencyMs: 0,
        skipped: true,
        skipReason: "non-local or non-http endpoint",
      });
      continue;
    }

    const start = Date.now();
    try {
      const response = await fetch(endpoint.url, { signal: AbortSignal.timeout(timeoutMs) });
      results.push({
        name: endpoint.name,
        url: endpoint.url,
        reachable: response.status < 500,
        statusCode: response.status,
        latencyMs: Date.now() - start,
        skipped: false,
      });
    } catch (error) {
      results.push({
        name: endpoint.name,
        url: endpoint.url,
        reachable: false,
        latencyMs: Date.now() - start,
        skipped: false,
        error: error instanceof Error ? error.message : Bun.inspect(error),
      });
    }
  }

  return results;
}

export async function discoverDxInventory(
  projectRoot: string,
  configRel = DX_CONFIG_FILENAME,
  options: DiscoverDxInventoryOptions = {}
): Promise<DiscoverDxInventoryReport> {
  const configPath = join(projectRoot, configRel);
  if (!pathExists(configPath)) {
    throw new Error(`missing ${configRel} at ${configPath}`);
  }

  const text = await Bun.file(configPath).text();
  const parsed = record(Bun.TOML.parse(text));
  const herdr = record(parsed.herdr);
  const orchestratorRaw = record(herdr.orchestrator);
  const orchestrator = parseHerdrOrchestratorSection(herdr);
  const finishWork = record(parsed.finishWork);
  const finishWorkFollowUp = record(finishWork.followUp);
  const dashboard = record(orchestratorRaw.dashboard);

  const gates = Array.isArray(finishWork.gates)
    ? finishWork.gates.filter((gate): gate is string => typeof gate === "string")
    : [];

  const endpoints = discoverEndpoints(parsed, text);
  const handoffRules = discoverHandoffRules(parsed, text);
  const remoteHosts = discoverRemoteHosts(parsed, handoffRules);
  const probeCoverage = buildProbeCoverage(handoffRules);
  const unconfiguredProbes = probeCoverage
    .filter((entry) => !entry.configured)
    .map((entry) => entry.id);
  const uniqueUrls = new Set(endpoints.map((entry) => entry.url));
  const duplicateUrlGroups = [...uniqueUrls].filter(
    (url) => endpoints.filter((entry) => entry.url === url).length > 1
  ).length;
  const portAlignment = buildPortAlignment(parsed, endpoints);
  const gaps = collectGaps({ endpoints, handoffRules, remoteHosts, probeCoverage, parsed });

  const liveProbes = options.evaluateProbes
    ? await evaluateConfiguredProbes(projectRoot, handoffRules)
    : undefined;
  const endpointReachability = options.probeEndpoints
    ? await probeEndpointReachability(endpoints, options.probeTimeoutMs ?? 2000)
    : undefined;

  const body = {
    configPath,
    endpointCount: endpoints.length,
    uniqueUrlCount: uniqueUrls.size,
    duplicateUrlGroups,
    handoffRuleCount: handoffRules.length,
    finishWorkGateCount: gates.length,
    remoteHostCount: remoteHosts.length,
    configuredProbeCount: probeCoverage.filter((entry) => entry.configured).length,
    availableProbeCount: probeCoverage.length,
    registeredTomlTables: listTomlPropertyTablePaths(),
    portAlignment,
    liveProbes,
    endpointReachability,
    orchestrator: {
      enabled: orchestrator?.enabled ?? false,
      handoffFrom: orchestrator?.handoffFrom ?? undefined,
      handoffTo: orchestrator?.handoffTo ?? undefined,
      contextOnIdle: orchestrator?.contextOnIdle ?? false,
      reviewerTab: orchestrator?.reviewerTab ?? undefined,
      dashboardExamplesUrl:
        typeof dashboard.examplesUrl === "string" ? dashboard.examplesUrl : undefined,
    },
    finishWork: {
      gates,
      followUp:
        typeof finishWorkFollowUp.command === "string" ? finishWorkFollowUp.command : undefined,
    },
    endpoints,
    handoffRules,
    remoteHosts,
    probeCoverage,
    unconfiguredProbes,
    gaps,
  };

  return {
    ...body,
    healthScore: computeDxHealthScore(body),
  };
}

/** Evaluate any supported `probe:*` handoff condition. */
export async function evaluateHandoffProbeCondition(
  probeId: string,
  projectRoot: string,
  home?: string
): Promise<{ ok: boolean; message: string }> {
  if (isCanonicalReferencesProbeId(probeId)) {
    return evaluateProbeHandoffCondition(probeId, projectRoot, home);
  }
  if (isBunInstallProbeId(probeId)) {
    return evaluateBunInstallProbeHandoffCondition(probeId, projectRoot);
  }
  if (isArtifactGraphProbeId(probeId)) {
    return evaluateArtifactGraphProbeHandoffCondition(probeId, projectRoot);
  }
  if (isFinishWorkProbeId(probeId)) {
    return evaluateFinishWorkProbeCondition(probeId, projectRoot);
  }
  return { ok: false, message: `unknown probe condition: ${probeId}` };
}
