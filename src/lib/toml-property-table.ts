/**
 * TOML property tables — resolved config rows for dx.config.toml sections.
 */

import { pathExists } from "./bun-io.ts";
import { resolve } from "path";
import { TOML } from "bun";
import {
  normalizeRemoteHostConfig,
  parseHerdrOrchestratorSection,
  resolveTargetStrategy,
  type RemoteDefaults,
  type RemoteHostConfig,
} from "./herdr-orchestrator-config.ts";
import {
  emptyToEmDash,
  formatMarkdownPropertyTable,
  type MarkdownTableColumnSpec,
} from "./markdown-table.ts";
import { filterColumnSpecsForColumns } from "./property-table-options.ts";
import { gitLastModified, parseGitLogTimestamp } from "./property-table.ts";

export const HANDOFF_RULES_TABLE_COLUMNS = [
  "FromWorkspace",
  "FromAgent",
  "Condition",
  "When",
  "ToWorkspace",
  "ToAgent",
  "ToSession",
  "TargetStrategy",
  "LastModified",
] as const;

export type HandoffRulesTableColumn = (typeof HANDOFF_RULES_TABLE_COLUMNS)[number];
export type HandoffRulesTableRow = Record<HandoffRulesTableColumn, string>;

export const REMOTE_HOSTS_TABLE_COLUMNS = [
  "Host",
  "Port",
  "User",
  "IdentityFile",
  "Timeout",
  "ConnectTimeout",
  "LastModified",
] as const;

export type RemoteHostsTableColumn = (typeof REMOTE_HOSTS_TABLE_COLUMNS)[number];
export type RemoteHostsTableRow = Record<RemoteHostsTableColumn, string>;

export const REMOTE_HOSTS_COLUMN_SPECS: readonly MarkdownTableColumnSpec[] = [
  { name: "Host", kind: "text" },
  { name: "Port", kind: "number" },
  { name: "User", kind: "text" },
  { name: "IdentityFile", kind: "path" },
  { name: "Timeout", kind: "number" },
  { name: "ConnectTimeout", kind: "number" },
  { name: "LastModified", kind: "date" },
];

export const HANDOFF_RULES_COLUMN_SPECS: readonly MarkdownTableColumnSpec[] = [
  { name: "FromWorkspace", kind: "text" },
  { name: "FromAgent", kind: "text" },
  { name: "Condition", kind: "text" },
  { name: "When", kind: "text" },
  { name: "ToWorkspace", kind: "text" },
  { name: "ToAgent", kind: "text" },
  { name: "ToSession", kind: "text" },
  { name: "TargetStrategy", kind: "text" },
  { name: "LastModified", kind: "date" },
];

export const ORCHESTRATOR_SUMMARY_COLUMN_SPECS: readonly MarkdownTableColumnSpec[] = [
  { name: "Property", kind: "text" },
  { name: "Value", kind: "text" },
];

export const ENDPOINTS_TABLE_COLUMNS = ["name", "url"] as const;

export const ENDPOINTS_COLUMN_SPECS: readonly MarkdownTableColumnSpec[] = [
  { name: "name", kind: "text" },
  { name: "url", kind: "text" },
];

export interface TomlPropertyTableResult {
  tablePath: string;
  filePath: string;
  columns: readonly string[];
  rows: Record<string, string>[];
}

export interface TomlPropertyTableRegistryEntry {
  title: string;
  columns: readonly string[];
  columnSpecs?: readonly MarkdownTableColumnSpec[];
  build: (ctx: TomlPropertyTableContext) => Promise<TomlPropertyTableResult>;
}

export interface TomlPropertyTableContext {
  projectRoot: string;
  filePath: string;
  absoluteFile: string;
  parsed: Record<string, unknown>;
  tablePath: string;
}

const EMPTY = emptyToEmDash(null);

function formatGitDay(iso: string): string {
  const trimmed = parseGitLogTimestamp(iso) || iso.trim();
  if (!trimmed) return EMPTY;
  return trimmed.slice(0, 10);
}

function formatFileMtimeDay(absoluteFile: string): string {
  const ms = Bun.file(absoluteFile).lastModified;
  if (!ms) return EMPTY;
  return new Date(ms).toISOString().slice(0, 10);
}

function displayOptional(value: string | number | undefined): string {
  return emptyToEmDash(value);
}

async function lineLastModified(
  projectRoot: string,
  absoluteFile: string,
  matches: (line: string) => boolean
): Promise<string> {
  const text = await Bun.file(absoluteFile).text();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trimStart().startsWith("#")) continue;
    if (matches(line)) {
      const iso = await gitLastModified(projectRoot, absoluteFile, i + 1);
      const day = formatGitDay(iso);
      return day === EMPTY ? formatFileMtimeDay(absoluteFile) : day;
    }
  }
  const iso = await gitLastModified(projectRoot, absoluteFile, 1);
  const day = formatGitDay(iso);
  return day === EMPTY ? formatFileMtimeDay(absoluteFile) : day;
}

function readHerdrOrchestrator(parsed: Record<string, unknown>) {
  const herdr = parsed.herdr;
  if (herdr == null || typeof herdr !== "object") {
    throw new Error("Missing [herdr] section in TOML");
  }
  const orch = parseHerdrOrchestratorSection(herdr as Record<string, unknown>);
  if (!orch) throw new Error("Missing [herdr.orchestrator] section in TOML");
  return orch;
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

function formatWhenClause(
  rule: { when?: Array<{ path: string; expected: string | boolean | number }> },
  rawWhen: unknown
): string {
  const fromParsed = rule.when?.length
    ? rule.when.map((c) => `${c.path}=${String(c.expected)}`)
    : [];
  const fromRaw = flattenWhenObject(rawWhen).map(([path, value]) => `${path}=${String(value)}`);
  const clauses = fromParsed.length > 0 ? fromParsed : fromRaw;
  return clauses.length > 0 ? clauses.join(", ") : EMPTY;
}

function readRawHandoffRules(parsed: Record<string, unknown>): unknown[] {
  const herdr = parsed.herdr;
  if (!herdr || typeof herdr !== "object") return [];
  const orchestrator = (herdr as Record<string, unknown>).orchestrator;
  if (!orchestrator || typeof orchestrator !== "object") return [];
  const rules = (orchestrator as Record<string, unknown>).handoff_rules;
  return Array.isArray(rules) ? rules : [];
}

function handoffRuleLineNumber(lines: string[], ruleIndex: number): number {
  const blockHeader = /^\s*\[\[herdr\.orchestrator\.handoff_rules\]\]\s*$/;
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (blockHeader.test(lines[i]!)) {
      seen++;
      if (seen === ruleIndex) return i + 1;
    }
  }
  return 1;
}

async function buildHandoffRulesTable(
  ctx: TomlPropertyTableContext
): Promise<TomlPropertyTableResult> {
  const orch = readHerdrOrchestrator(ctx.parsed);
  const rawRules = readRawHandoffRules(ctx.parsed);
  const text = await Bun.file(ctx.absoluteFile).text();
  const lines = text.split("\n");
  const rows: HandoffRulesTableRow[] = [];

  for (let i = 0; i < orch.handoffRules.length; i++) {
    const rule = orch.handoffRules[i]!;
    const rawEntry =
      rawRules[i] && typeof rawRules[i] === "object"
        ? (rawRules[i] as Record<string, unknown>)
        : null;
    const line = handoffRuleLineNumber(lines, i);
    const iso = await gitLastModified(ctx.projectRoot, ctx.absoluteFile, line);
    const day = formatGitDay(iso);
    const lastModified = day === EMPTY ? formatFileMtimeDay(ctx.absoluteFile) : day;

    rows.push({
      FromWorkspace: emptyToEmDash(rule.fromWorkspace),
      FromAgent: emptyToEmDash(rule.fromAgent),
      Condition: emptyToEmDash(rule.condition),
      When: formatWhenClause(rule, rawEntry?.when),
      ToWorkspace: emptyToEmDash(rule.toWorkspace),
      ToAgent: emptyToEmDash(rule.toAgent),
      ToSession: displayOptional(rule.toSession),
      TargetStrategy: emptyToEmDash(resolveTargetStrategy(rule)),
      LastModified: lastModified,
    });
  }

  return {
    tablePath: ctx.tablePath,
    filePath: ctx.filePath,
    columns: HANDOFF_RULES_TABLE_COLUMNS,
    rows,
  };
}

async function buildRemoteHostsTable(
  ctx: TomlPropertyTableContext
): Promise<TomlPropertyTableResult> {
  const orch = readHerdrOrchestrator(ctx.parsed);
  const resolved = normalizeRemoteHostConfig(orch.remoteHosts, orch.remoteDefaults);
  const rows: RemoteHostsTableRow[] = [];

  for (const [label, host] of Object.entries(resolved).sort(([a], [b]) => a.localeCompare(b))) {
    const shorthand = new RegExp(`^\\s*${label}\\s*=`);
    const nested = new RegExp(`^\\s*\\[herdr\\.orchestrator\\.remote_hosts\\.${label}\\]\\s*$`);
    const lastModified = await lineLastModified(
      ctx.projectRoot,
      ctx.absoluteFile,
      (line) => shorthand.test(line) || nested.test(line)
    );

    rows.push({
      Host: label,
      Port: displayOptional(host.port),
      User: displayOptional(host.user),
      IdentityFile: displayOptional(host.identityFile),
      Timeout: String(Math.round(host.timeout / 1000)),
      ConnectTimeout: String(host.connectTimeout),
      LastModified: lastModified,
    });
  }

  return {
    tablePath: ctx.tablePath,
    filePath: ctx.filePath,
    columns: REMOTE_HOSTS_TABLE_COLUMNS,
    rows,
  };
}

function buildOrchestratorSummaryTable(
  ctx: TomlPropertyTableContext
): Promise<TomlPropertyTableResult> {
  const herdr = ctx.parsed.herdr;
  if (!herdr || typeof herdr !== "object") {
    throw new Error("Missing [herdr] section in TOML");
  }
  const orchestrator = (herdr as Record<string, unknown>).orchestrator;
  if (!orchestrator || typeof orchestrator !== "object") {
    throw new Error("Missing [herdr.orchestrator] section in TOML");
  }

  const columns = ["Property", "Value"] as const;
  const rows: Record<string, string>[] = [];

  for (const [key, value] of Object.entries(orchestrator as Record<string, unknown>)) {
    if (value == null) {
      rows.push({ Property: key, Value: EMPTY });
    } else if (Array.isArray(value)) {
      rows.push({ Property: key, Value: `(array: ${value.length} items)` });
    } else if (typeof value === "object") {
      rows.push({ Property: key, Value: "(table)" });
    } else {
      rows.push({ Property: key, Value: String(value) });
    }
  }

  return Promise.resolve({
    tablePath: ctx.tablePath,
    filePath: ctx.filePath,
    columns,
    rows,
  });
}

/**
 * Build the `[herdr.orchestrator.dashboard]` property table.
 *
 * @see docs/references/dashboard-thumbnails.md Dashboard thumbnail architecture
 */
function buildOrchestratorDashboardTable(
  ctx: TomlPropertyTableContext
): Promise<TomlPropertyTableResult> {
  const herdr = ctx.parsed.herdr;
  if (!herdr || typeof herdr !== "object") {
    throw new Error("Missing [herdr] section in TOML");
  }
  const orchestrator = (herdr as Record<string, unknown>).orchestrator;
  if (!orchestrator || typeof orchestrator !== "object") {
    throw new Error("Missing [herdr.orchestrator] section in TOML");
  }
  const dashboard = (orchestrator as Record<string, unknown>).dashboard;
  if (!dashboard || typeof dashboard !== "object") {
    throw new Error("Missing [herdr.orchestrator.dashboard] section in TOML");
  }

  const columns = ["Property", "Value"] as const;
  const rows: Record<string, string>[] = [];

  for (const [key, value] of Object.entries(dashboard as Record<string, unknown>)) {
    if (value == null) {
      rows.push({ Property: key, Value: EMPTY });
    } else if (Array.isArray(value)) {
      rows.push({ Property: key, Value: `(array: ${value.length} items)` });
    } else if (typeof value === "object") {
      rows.push({ Property: key, Value: "(table)" });
    } else {
      rows.push({ Property: key, Value: String(value) });
    }
  }

  return Promise.resolve({
    tablePath: ctx.tablePath,
    filePath: ctx.filePath,
    columns,
    rows,
  });
}

async function buildEndpointsTable(
  ctx: TomlPropertyTableContext
): Promise<TomlPropertyTableResult> {
  const raw = ctx.parsed.endpoints;
  if (!Array.isArray(raw)) {
    throw new Error("Missing [[endpoints]] array in TOML");
  }
  const rows: Record<string, string>[] = [];
  for (const entry of raw) {
    if (entry == null || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    rows.push({
      name: displayOptional(row.name as string | undefined),
      url: displayOptional(row.url as string | undefined),
    });
  }
  return {
    tablePath: ctx.tablePath,
    filePath: ctx.filePath,
    columns: ENDPOINTS_TABLE_COLUMNS,
    rows,
  };
}

/** Registered TOML table paths → builder. */
export const TOML_PROPERTY_TABLE_REGISTRY: Record<string, TomlPropertyTableRegistryEntry> = {
  endpoints: {
    title: "endpoints",
    columns: ENDPOINTS_TABLE_COLUMNS,
    columnSpecs: ENDPOINTS_COLUMN_SPECS,
    build: buildEndpointsTable,
  },
  "herdr.orchestrator": {
    title: "herdr.orchestrator",
    columns: ["Property", "Value"],
    columnSpecs: ORCHESTRATOR_SUMMARY_COLUMN_SPECS,
    build: buildOrchestratorSummaryTable,
  },
  "herdr.orchestrator.remote_hosts": {
    title: "herdr.orchestrator.remote_hosts",
    columns: REMOTE_HOSTS_TABLE_COLUMNS,
    columnSpecs: REMOTE_HOSTS_COLUMN_SPECS,
    build: buildRemoteHostsTable,
  },
  "herdr.orchestrator.handoff_rules": {
    title: "herdr.orchestrator.handoff_rules",
    columns: HANDOFF_RULES_TABLE_COLUMNS,
    columnSpecs: HANDOFF_RULES_COLUMN_SPECS,
    build: buildHandoffRulesTable,
  },
  "herdr.orchestrator.dashboard": {
    title: "herdr.orchestrator.dashboard",
    columns: ["Property", "Value"],
    columnSpecs: ORCHESTRATOR_SUMMARY_COLUMN_SPECS,
    build: buildOrchestratorDashboardTable,
  },
};

export function listTomlPropertyTablePaths(): string[] {
  return Object.keys(TOML_PROPERTY_TABLE_REGISTRY).sort();
}

export async function buildTomlPropertyTables(options: {
  projectRoot: string;
  filePath: string;
  tablePaths: string[];
}): Promise<TomlPropertyTableResult[]> {
  const results: TomlPropertyTableResult[] = [];
  for (const tablePath of options.tablePaths) {
    results.push(
      await buildTomlPropertyTable({
        projectRoot: options.projectRoot,
        filePath: options.filePath,
        tablePath,
      })
    );
  }
  return results;
}

async function formatUnknownTomlTablePathError(
  tablePath: string,
  projectRoot: string,
  filePath: string
): Promise<string> {
  const registered = listTomlPropertyTablePaths().join(", ");
  const absoluteFile = resolve(projectRoot, filePath);
  let topLevel = "(file not found)";
  if (pathExists(absoluteFile)) {
    try {
      const parsed = TOML.parse(await Bun.file(absoluteFile).text()) as Record<string, unknown>;
      const keys = Object.keys(parsed).sort();
      topLevel = keys.length > 0 ? keys.join(", ") : "(empty document)";
    } catch {
      topLevel = "(parse failed)";
    }
  }
  return (
    `Unknown table path "${tablePath}". ` +
    `Registered tables: ${registered}. ` +
    `Top-level keys in ${filePath}: ${topLevel}`
  );
}

export async function buildTomlPropertyTable(options: {
  projectRoot: string;
  filePath: string;
  tablePath: string;
}): Promise<TomlPropertyTableResult> {
  const entry = TOML_PROPERTY_TABLE_REGISTRY[options.tablePath];
  if (!entry) {
    throw new Error(
      await formatUnknownTomlTablePathError(
        options.tablePath,
        options.projectRoot,
        options.filePath
      )
    );
  }

  const absoluteFile = resolve(options.projectRoot, options.filePath);
  if (!pathExists(absoluteFile)) {
    throw new Error(`File not found: ${options.filePath}`);
  }

  const parsed = TOML.parse(await Bun.file(absoluteFile).text()) as Record<string, unknown>;
  return entry.build({
    projectRoot: options.projectRoot,
    filePath: options.filePath,
    absoluteFile,
    parsed,
    tablePath: options.tablePath,
  });
}

export function formatTomlPropertyTableMarkdown(
  result: TomlPropertyTableResult,
  options: { columnSpecs?: readonly MarkdownTableColumnSpec[] } = {}
): string {
  const entry = TOML_PROPERTY_TABLE_REGISTRY[result.tablePath];
  const columnSpecs = filterColumnSpecsForColumns(
    options.columnSpecs ?? entry?.columnSpecs,
    result.columns
  );
  return formatMarkdownPropertyTable({
    title: result.tablePath,
    source: result.filePath,
    columns: result.columns,
    rows: result.rows,
    columnSpecs,
  });
}

export function formatTomlPropertyTableInspect(result: TomlPropertyTableResult): string {
  return Bun.inspect.table(result.rows, [...result.columns]);
}

/** Extract raw remote_hosts map (for tests). */
export function readRemoteHostsFromToml(parsed: Record<string, unknown>): {
  hosts: Record<string, string | RemoteHostConfig>;
  defaults: RemoteDefaults;
} {
  const orch = readHerdrOrchestrator(parsed);
  return { hosts: orch.remoteHosts, defaults: orch.remoteDefaults };
}
