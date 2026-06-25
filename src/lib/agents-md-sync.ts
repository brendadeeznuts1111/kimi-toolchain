/**
 * AGENTS.md marker-based sync — live code/config → architecture tables.
 */

import { safeParse } from "./utils.ts";
import { extractMarkdownTablesFallback } from "./bun-markdown.ts";
import { listBuiltinGateDefinitions } from "../gates/registry.ts";

const LIB_README_REL = "src/lib/README.md";
const DX_CONFIG_REL = "dx.config.toml";

interface PackageJson {
  bin?: Record<string, string>;
}

function isPackageJson(val: unknown): val is PackageJson {
  return (
    typeof val === "object" &&
    val !== null &&
    ("bin" in val === false || typeof (val as PackageJson).bin === "object")
  );
}

interface DxEndpoint {
  name?: string;
  url?: string;
}

interface DxConfigToml {
  endpoints?: DxEndpoint[];
  finishWork?: { gates?: string[] };
}

function isDxConfigToml(val: unknown): val is DxConfigToml {
  return typeof val === "object" && val !== null;
}

export interface LibDomainRow {
  domain: string;
  files: string;
}

export async function readPackageBins(projectDir: string): Promise<Record<string, string> | null> {
  const pkgFile = Bun.file(`${projectDir}/package.json`);
  if (!(await pkgFile.exists())) return null;
  const pkgRaw = safeParse(await pkgFile.text(), null, isPackageJson);
  if (pkgRaw === null) return null;
  return pkgRaw.bin ?? {};
}

export async function readDxEndpoints(
  projectDir: string
): Promise<Array<{ name: string; url: string }> | null> {
  const configFile = Bun.file(`${projectDir}/${DX_CONFIG_REL}`);
  if (!(await configFile.exists())) return null;
  const parsed = Bun.TOML.parse(await configFile.text());
  if (!isDxConfigToml(parsed)) return null;

  const endpoints = (parsed.endpoints ?? [])
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name.trim() : "",
      url: typeof entry.url === "string" ? entry.url.trim() : "",
    }))
    .filter((entry) => entry.name && entry.url)
    .sort((a, b) => a.name.localeCompare(b.name));

  return endpoints;
}

export async function readFinishWorkGates(projectDir: string): Promise<string[] | null> {
  const configFile = Bun.file(`${projectDir}/${DX_CONFIG_REL}`);
  if (!(await configFile.exists())) return null;
  const parsed = Bun.TOML.parse(await configFile.text());
  if (!isDxConfigToml(parsed)) return null;

  const gates = parsed.finishWork?.gates;
  if (!Array.isArray(gates)) return [];
  return gates.filter((gate): gate is string => typeof gate === "string" && gate.trim().length > 0);
}

export async function readLibDomainRows(projectDir: string): Promise<LibDomainRow[] | null> {
  const readmeFile = Bun.file(`${projectDir}/${LIB_README_REL}`);
  if (!(await readmeFile.exists())) return null;

  const text = await readmeFile.text();
  const heading = text.match(/^## Domains[ \t]*$/m);
  if (!heading) return [];
  const body = text.slice(heading.index! + heading[0].length);
  const nextHeading = body.search(/\n#{1,6}\s+/);
  const table = extractMarkdownTablesFallback(
    nextHeading >= 0 ? body.slice(0, nextHeading) : body
  )[0];
  if (!table) return [];

  const domainIdx = table.headers.findIndex((header) => /domain/i.test(header));
  const filesIdx = table.headers.findIndex((header) => /files/i.test(header));
  if (domainIdx < 0 || filesIdx < 0) return [];

  return table.rows
    .map((row) => ({
      domain: row[domainIdx]?.trim() ?? "",
      files: row[filesIdx]?.trim() ?? "",
    }))
    .filter((row) => row.domain.length > 0);
}

export function readBuiltinGateNames(): string[] {
  return listBuiltinGateDefinitions()
    .map((gate) => gate.name)
    .sort((a, b) => a.localeCompare(b));
}

export const AGENTS_FILE = "AGENTS.md";

export const AGENTS_SYNC_BINS_BEGIN = "<!-- agents-sync:bins:begin -->";
export const AGENTS_SYNC_BINS_END = "<!-- agents-sync:bins:end -->";
export const AGENTS_SYNC_ENDPOINTS_BEGIN = "<!-- agents-sync:endpoints:begin -->";
export const AGENTS_SYNC_ENDPOINTS_END = "<!-- agents-sync:endpoints:end -->";
export const AGENTS_SYNC_LIB_DOMAINS_BEGIN = "<!-- agents-sync:lib-domains:begin -->";
export const AGENTS_SYNC_LIB_DOMAINS_END = "<!-- agents-sync:lib-domains:end -->";
export const AGENTS_SYNC_FINISH_WORK_BEGIN = "<!-- agents-sync:finish-work-gates:begin -->";
export const AGENTS_SYNC_FINISH_WORK_END = "<!-- agents-sync:finish-work-gates:end -->";

const PACKAGE_BIN_COUNT_RE = /`bin` map \(\d+ registered CLI tools\)/;
const SRC_BIN_COUNT_RE = /CLI entry points \(\d+ registered bins in `package\.json` `bin`\)/;
const GATES_ROW_RE = /Built-in execution gates \([^)]+\)/;
const DX_ENDPOINT_COUNT_RE = /`\[\[endpoints\]\]` inventory(?: \(\d+ endpoints\))?/;

interface SyncBlockSpec {
  id: string;
  begin: string;
  end: string;
  heading: string;
  insertAfter: string;
  /** When true, `heading` already exists — only replace the body under it. */
  existingHeading?: boolean;
}

const SYNC_BLOCKS: SyncBlockSpec[] = [
  {
    id: "bins",
    begin: AGENTS_SYNC_BINS_BEGIN,
    end: AGENTS_SYNC_BINS_END,
    heading: "### Registered CLI bins (`package.json` `bin`)",
    insertAfter: "### Top-level directories",
  },
  {
    id: "endpoints",
    begin: AGENTS_SYNC_ENDPOINTS_BEGIN,
    end: AGENTS_SYNC_ENDPOINTS_END,
    heading: "### DX endpoints (`dx.config.toml` `[[endpoints]]`)",
    insertAfter: AGENTS_SYNC_BINS_END,
  },
  {
    id: "lib-domains",
    begin: AGENTS_SYNC_LIB_DOMAINS_BEGIN,
    end: AGENTS_SYNC_LIB_DOMAINS_END,
    heading: "### `src/lib/` domains (summary)",
    insertAfter: AGENTS_SYNC_LIB_DOMAINS_END,
    existingHeading: true,
  },
  {
    id: "finish-work-gates",
    begin: AGENTS_SYNC_FINISH_WORK_BEGIN,
    end: AGENTS_SYNC_FINISH_WORK_END,
    heading: "### Finish-work gates (`dx.config.toml` `[finishWork]`)",
    insertAfter: "**There is no build step.** TypeScript is run directly via `bun run`.",
  },
];

function buildMarkerBlock(begin: string, end: string, tableLines: string[]): string {
  return [begin, "", ...tableLines, "", end].join("\n");
}

/** Build the auto-sync bin inventory block for AGENTS.md. */
export function buildBinInventoryBlock(bins: Record<string, string>): string {
  const rows = Object.entries(bins).sort(([a], [b]) => a.localeCompare(b));
  return buildMarkerBlock(AGENTS_SYNC_BINS_BEGIN, AGENTS_SYNC_BINS_END, [
    "| Bin | Entry |",
    "| --- | ----- |",
    ...rows.map(([name, entry]) => `| \`${name}\` | \`${entry}\` |`),
  ]);
}

export function buildEndpointsBlock(
  endpoints: ReadonlyArray<{ name: string; url: string }>
): string {
  return buildMarkerBlock(AGENTS_SYNC_ENDPOINTS_BEGIN, AGENTS_SYNC_ENDPOINTS_END, [
    "| Name | URL |",
    "| ---- | --- |",
    ...endpoints.map((entry) => `| \`${entry.name}\` | ${entry.url} |`),
  ]);
}

export function buildLibDomainsBlock(
  rows: ReadonlyArray<{ domain: string; files: string }>
): string {
  return buildMarkerBlock(AGENTS_SYNC_LIB_DOMAINS_BEGIN, AGENTS_SYNC_LIB_DOMAINS_END, [
    "| Domain | Representative files |",
    "| ------ | -------------------- |",
    ...rows.map((row) => `| ${row.domain} | ${row.files} |`),
  ]);
}

export function buildFinishWorkGatesBlock(gates: readonly string[]): string {
  return buildMarkerBlock(AGENTS_SYNC_FINISH_WORK_BEGIN, AGENTS_SYNC_FINISH_WORK_END, [
    "| # | Gate command |",
    "| - | ------------ |",
    ...gates.map((gate, index) => `| ${index + 1} | \`${gate}\` |`),
  ]);
}

/** Patch hard-coded bin counts elsewhere in AGENTS.md prose/tables. */
export function patchBinCounts(agentsMd: string, count: number): string {
  return agentsMd
    .replace(PACKAGE_BIN_COUNT_RE, `\`bin\` map (${count} registered CLI tools)`)
    .replace(
      SRC_BIN_COUNT_RE,
      `CLI entry points (${count} registered bins in \`package.json\` \`bin\`)`
    );
}

export function patchGateNames(agentsMd: string, gateNames: readonly string[]): string {
  const formatted = gateNames.map((name) => `\`${name}\``).join(", ");
  return agentsMd.replace(GATES_ROW_RE, `Built-in execution gates (${formatted})`);
}

export function patchDxEndpointInventory(agentsMd: string, count: number): string {
  return agentsMd.replace(DX_ENDPOINT_COUNT_RE, `\`[[endpoints]]\` inventory (${count} endpoints)`);
}

function extractMarkerBlock(agentsMd: string, begin: string, end: string): string | null {
  const start = agentsMd.indexOf(begin);
  const stop = agentsMd.indexOf(end);
  if (start < 0 || stop <= start) return null;
  return agentsMd.slice(start, stop + end.length);
}

function replaceMarkerBlock(agentsMd: string, begin: string, end: string, block: string): string {
  const start = agentsMd.indexOf(begin);
  const stop = agentsMd.indexOf(end);
  if (start >= 0 && stop > start) {
    return agentsMd.slice(0, start) + block + agentsMd.slice(stop + end.length);
  }
  return agentsMd;
}

function insertBlockSection(agentsMd: string, spec: SyncBlockSpec, block: string): string {
  if (spec.existingHeading) {
    const headingAt = agentsMd.indexOf(spec.heading);
    if (headingAt < 0) {
      throw new Error(`AGENTS.md missing section heading: ${spec.heading}`);
    }
    const afterHeading = headingAt + spec.heading.length;
    const nextSection = agentsMd.indexOf("\n\n### ", afterHeading);
    const end = nextSection >= 0 ? nextSection : agentsMd.length;
    return agentsMd.slice(0, afterHeading) + `\n\n${block}\n` + agentsMd.slice(end);
  }

  const anchor = agentsMd.indexOf(spec.insertAfter);
  if (anchor < 0) {
    throw new Error(`AGENTS.md missing sync anchor: ${spec.insertAfter}`);
  }

  const afterAnchor = anchor + spec.insertAfter.length;
  const nextHeading = agentsMd.indexOf("\n\n### ", afterAnchor);
  const nextSection = agentsMd.indexOf("\n\n## ", afterAnchor);
  const cutPoints = [nextHeading, nextSection].filter((index) => index >= 0);
  const insertAt = cutPoints.length > 0 ? Math.min(...cutPoints) : agentsMd.length;

  const section = `\n\n${spec.heading}\n\n${block}\n`;
  return agentsMd.slice(0, insertAt) + section + agentsMd.slice(insertAt);
}

export interface AgentsMdExpectedBlocks {
  bins: string | null;
  endpoints: string | null;
  libDomains: string | null;
  finishWorkGates: string | null;
}

export interface AgentsMdSyncStatus {
  fresh: boolean;
  staleBlocks: string[];
  binCount: number;
  endpointCount: number;
  gateCount: number;
  expected: AgentsMdExpectedBlocks;
  actual: AgentsMdExpectedBlocks;
}

async function buildExpectedBlocks(projectDir: string): Promise<AgentsMdExpectedBlocks | null> {
  const bins = await readPackageBins(projectDir);
  if (bins === null) return null;

  const endpoints = await readDxEndpoints(projectDir);
  const libDomains = await readLibDomainRows(projectDir);
  const finishWorkGates = await readFinishWorkGates(projectDir);

  return {
    bins: buildBinInventoryBlock(bins),
    endpoints: endpoints ? buildEndpointsBlock(endpoints) : null,
    libDomains: libDomains ? buildLibDomainsBlock(libDomains) : null,
    finishWorkGates: finishWorkGates ? buildFinishWorkGatesBlock(finishWorkGates) : null,
  };
}

async function evaluateSyncStatus(
  projectDir: string,
  agentsMd: string
): Promise<AgentsMdSyncStatus | null> {
  const expected = await buildExpectedBlocks(projectDir);
  if (expected === null) return null;

  const bins = await readPackageBins(projectDir);
  const endpoints = await readDxEndpoints(projectDir);
  const gateNames = readBuiltinGateNames();

  const actual: AgentsMdExpectedBlocks = {
    bins: extractMarkerBlock(agentsMd, AGENTS_SYNC_BINS_BEGIN, AGENTS_SYNC_BINS_END),
    endpoints: extractMarkerBlock(agentsMd, AGENTS_SYNC_ENDPOINTS_BEGIN, AGENTS_SYNC_ENDPOINTS_END),
    libDomains: extractMarkerBlock(
      agentsMd,
      AGENTS_SYNC_LIB_DOMAINS_BEGIN,
      AGENTS_SYNC_LIB_DOMAINS_END
    ),
    finishWorkGates: extractMarkerBlock(
      agentsMd,
      AGENTS_SYNC_FINISH_WORK_BEGIN,
      AGENTS_SYNC_FINISH_WORK_END
    ),
  };

  const staleBlocks: string[] = [];
  for (const spec of SYNC_BLOCKS) {
    const key =
      spec.id === "finish-work-gates"
        ? "finishWorkGates"
        : spec.id === "lib-domains"
          ? "libDomains"
          : (spec.id as "bins" | "endpoints");
    const expectedBlock = expected[key];
    const actualBlock = actual[key];
    if (!expectedBlock) continue;
    if (actualBlock !== expectedBlock) staleBlocks.push(spec.id);
  }

  let prose = agentsMd;
  if (bins) prose = patchBinCounts(prose, Object.keys(bins).length);
  if (endpoints) prose = patchDxEndpointInventory(prose, endpoints.length);
  prose = patchGateNames(prose, gateNames);
  const proseFresh = prose === agentsMd;

  return {
    fresh: staleBlocks.length === 0 && proseFresh,
    staleBlocks,
    binCount: bins ? Object.keys(bins).length : 0,
    endpointCount: endpoints?.length ?? 0,
    gateCount: gateNames.length,
    expected,
    actual,
  };
}

/** Compare all AGENTS.md sync blocks against live project sources. */
export async function checkAgentsMdSync(projectDir: string): Promise<AgentsMdSyncStatus | null> {
  const agentsFile = Bun.file(`${projectDir}/${AGENTS_FILE}`);
  if (!(await agentsFile.exists())) {
    const expected = await buildExpectedBlocks(projectDir);
    if (!expected) return null;
    return {
      fresh: false,
      staleBlocks: SYNC_BLOCKS.map((block) => block.id),
      binCount: 0,
      endpointCount: 0,
      gateCount: readBuiltinGateNames().length,
      expected,
      actual: { bins: null, endpoints: null, libDomains: null, finishWorkGates: null },
    };
  }

  return evaluateSyncStatus(projectDir, await agentsFile.text());
}

/** Rewrite all marker blocks and prose patches in AGENTS.md. */
export async function syncAgentsMd(projectDir: string): Promise<number> {
  const expected = await buildExpectedBlocks(projectDir);
  if (!expected) return -1;

  const path = `${projectDir}/${AGENTS_FILE}`;
  const agentsFile = Bun.file(path);
  if (!(await agentsFile.exists())) return -1;

  let agentsMd = await agentsFile.text();
  const original = agentsMd;
  let updates = 0;

  for (const spec of SYNC_BLOCKS) {
    const key =
      spec.id === "finish-work-gates"
        ? "finishWorkGates"
        : spec.id === "lib-domains"
          ? "libDomains"
          : (spec.id as "bins" | "endpoints");
    const block = expected[key];
    if (!block) continue;

    const before = agentsMd;
    if (agentsMd.includes(spec.begin) && agentsMd.includes(spec.end)) {
      agentsMd = replaceMarkerBlock(agentsMd, spec.begin, spec.end, block);
    } else if (spec.existingHeading && agentsMd.includes(spec.heading)) {
      agentsMd = insertBlockSection(agentsMd, spec, block);
    } else if (agentsMd.includes(spec.insertAfter)) {
      agentsMd = insertBlockSection(agentsMd, spec, block);
    }
    if (agentsMd !== before) updates++;
  }

  const bins = await readPackageBins(projectDir);
  const endpoints = await readDxEndpoints(projectDir);
  if (bins) agentsMd = patchBinCounts(agentsMd, Object.keys(bins).length);
  if (endpoints) agentsMd = patchDxEndpointInventory(agentsMd, endpoints.length);
  agentsMd = patchGateNames(agentsMd, readBuiltinGateNames());

  if (agentsMd === original) return 0;
  await Bun.write(path, agentsMd);
  return updates > 0 ? updates : 1;
}

export interface AgentsMdSyncCliResult {
  exitCode: number;
  message: string;
  binCount?: number;
  endpointCount?: number;
}

/** CLI entry — structured result instead of logging directly. */
export async function runAgentsMdSyncCli(args: string[]): Promise<AgentsMdSyncCliResult> {
  const EXIT_OK = 0;
  const EXIT_DRIFT = 1;
  const EXIT_ERROR = 1;

  try {
    const write = args.includes("--write");
    const projectDir = args.find((a) => !a.startsWith("-")) || Bun.cwd;

    if (write) {
      const synced = await syncAgentsMd(projectDir);
      if (synced === -1) {
        return { exitCode: EXIT_ERROR, message: "Error: missing package.json or AGENTS.md" };
      }
      const status = await checkAgentsMdSync(projectDir);
      if (synced > 0) {
        return {
          exitCode: EXIT_OK,
          message: `Synced AGENTS.md (${status?.binCount ?? 0} bins, ${status?.endpointCount ?? 0} endpoints, ${status?.gateCount ?? 0} doctor gates)`,
          binCount: status?.binCount,
          endpointCount: status?.endpointCount,
        };
      }
      return {
        exitCode: EXIT_OK,
        message: "AGENTS.md already in sync",
        binCount: status?.binCount,
        endpointCount: status?.endpointCount,
      };
    }

    const status = await checkAgentsMdSync(projectDir);
    if (status === null) {
      return { exitCode: EXIT_ERROR, message: "Error: invalid package.json" };
    }
    if (status.fresh) {
      return {
        exitCode: EXIT_OK,
        message: `AGENTS.md: in sync (${status.binCount} bins, ${status.endpointCount} endpoints, ${status.gateCount} doctor gates)`,
        binCount: status.binCount,
        endpointCount: status.endpointCount,
      };
    }

    const parts = ["AGENTS.md sync stale"];
    if (status.staleBlocks.length > 0) {
      parts.push(`blocks: ${status.staleBlocks.join(", ")}`);
    } else {
      parts.push("prose counts");
    }
    parts.push("run: bun run agents:sync");
    return {
      exitCode: EXIT_DRIFT,
      message: parts.join(" — "),
      binCount: status.binCount,
      endpointCount: status.endpointCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : Bun.inspect(err);
    return { exitCode: EXIT_ERROR, message: `Error: ${message}` };
  }
}
