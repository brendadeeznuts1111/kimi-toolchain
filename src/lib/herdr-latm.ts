/**
 * Local Agent Tool Mesh (LATM) — decentralized pane capability discovery + invocation.
 *
 * Each pane self-declares tools in ~/.config/herdr/agents/<paneId>/capabilities.json.
 * Orchestrators glob the filesystem and route via herdr pane run + wait-output.
 */

import { join } from "path";
import { writeStdoutLine } from "./cli-contract.ts";
import { pathExists, readJsonFile, removePath } from "./bun-io.ts";
import { execCli, execCliJson } from "./herdr-project-cli.ts";
import { paneRunSync } from "./herdr-pane-service.ts";
import { herdrAgentsDir, herdrLatmManifestPath, homeDir } from "./paths.ts";
import { ensureDir } from "./utils.ts";
import type { HerdrProjectConfig } from "./herdr-project-config.ts";
import { findWorkspaceForProject } from "./herdr-workspace-match.ts";

export const LATM_SCHEMA_VERSION = 1;
export const DEFAULT_LATM_TTL_MS = 300_000;
export const LATM_DONE_MARKER = "__LATM_DONE__";

export type LatmInvokeType = "cli" | "mcp";

export interface LatmToolInvokeCli {
  type: "cli";
  command: string;
}

export interface LatmToolInvokeMcp {
  type: "mcp";
  server: string;
}

export interface LatmTool {
  name: string;
  description: string;
  invoke: LatmToolInvokeCli | LatmToolInvokeMcp;
  readOnly: boolean;
  timeoutMs: number;
}

export interface LatmManifest {
  schemaVersion: number;
  agentId: string;
  paneId: string;
  workspaceId: string;
  role: string;
  tools: LatmTool[];
  ttlMs: number;
  updatedAt: string;
}

export interface DiscoveredTool extends LatmTool {
  agentId: string;
  paneId: string;
  workspaceId: string;
  role: string;
  manifestPath: string;
  ageMs: number;
  stale: boolean;
}

export interface LatmInvokeResult {
  tool: string;
  paneId: string;
  exitCode: number;
  output: unknown;
  raw?: string;
}

export interface LatmListReport {
  schemaVersion: 1;
  toolCount: number;
  staleCount: number;
  tools: DiscoveredTool[];
}

/** Lower = preferred for auto-routed invoke (avoid busy agent panes). */
export const LATM_INVOKE_ROLE_PRIORITY: Record<string, number> = {
  shell: 0,
  reviewer: 1,
  doctor: 2,
  test: 3,
  secondary: 4,
  build: 4,
  primary: 5,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLatmTool(value: unknown): value is LatmTool {
  if (!isRecord(value)) return false;
  if (typeof value.name !== "string" || typeof value.description !== "string") return false;
  if (typeof value.readOnly !== "boolean" || typeof value.timeoutMs !== "number") return false;
  const invoke = value.invoke;
  if (!isRecord(invoke) || typeof invoke.type !== "string") return false;
  if (invoke.type === "cli") return typeof invoke.command === "string";
  if (invoke.type === "mcp") return typeof invoke.server === "string";
  return false;
}

export function isLatmManifest(value: unknown): value is LatmManifest {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== LATM_SCHEMA_VERSION) return false;
  if (typeof value.agentId !== "string" || typeof value.paneId !== "string") return false;
  if (typeof value.workspaceId !== "string" || typeof value.role !== "string") return false;
  if (typeof value.ttlMs !== "number" || typeof value.updatedAt !== "string") return false;
  if (!Array.isArray(value.tools) || !value.tools.every(isLatmTool)) return false;
  return true;
}

export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Substitute {key} placeholders; values are shell-single-quoted. */
export function substituteLatmCommand(command: string, input: Record<string, unknown>): string {
  let resolved = command;
  for (const [key, val] of Object.entries(input)) {
    resolved = resolved.replaceAll(`{${key}}`, shellSingleQuote(String(val)));
  }
  return resolved;
}

export function latmToolsForRole(role: string, agentId?: string): LatmTool[] {
  const id = agentId || role;
  switch (role) {
    case "doctor":
      return [
        {
          name: "effect-gates",
          description: "Run Effect-TS gate checks",
          invoke: { type: "cli", command: "kimi-doctor --effect-gates --json" },
          readOnly: true,
          timeoutMs: 60_000,
        },
        {
          name: "diagnose",
          description: "Full workspace diagnosis",
          invoke: { type: "cli", command: "kimi-doctor --all --json" },
          readOnly: true,
          timeoutMs: 120_000,
        },
        {
          name: "diagnose_workspace",
          description: "Quick workspace doctor snapshot",
          invoke: { type: "cli", command: "kimi-doctor --quick --json" },
          readOnly: true,
          timeoutMs: 120_000,
        },
      ];
    case "primary":
      return [
        {
          name: "search_code",
          description: "Ripgrep search in workspace",
          invoke: { type: "cli", command: "rg -i {query} --json" },
          readOnly: true,
          timeoutMs: 30_000,
        },
        {
          name: "diagnose_workspace",
          description: "Run quick doctor checks",
          invoke: { type: "cli", command: "kimi-doctor --quick --json" },
          readOnly: true,
          timeoutMs: 120_000,
        },
      ];
    case "secondary":
    case "build":
      return [
        {
          name: "typecheck",
          description: "TypeScript type check",
          invoke: { type: "cli", command: "bun run typecheck" },
          readOnly: true,
          timeoutMs: 60_000,
        },
        {
          name: "lint",
          description: "Oxlint project sources",
          invoke: { type: "cli", command: "bun run lint" },
          readOnly: true,
          timeoutMs: 60_000,
        },
        {
          name: "build",
          description: "Fast quality gate",
          invoke: { type: "cli", command: "bun run check:fast" },
          readOnly: true,
          timeoutMs: 120_000,
        },
      ];
    case "test":
      return [
        {
          name: "run_tests",
          description: "Fast unit test gate",
          invoke: { type: "cli", command: "bun run test:fast" },
          readOnly: true,
          timeoutMs: 120_000,
        },
        {
          name: "coverage",
          description: "Test suite with coverage",
          invoke: { type: "cli", command: "bun run test:coverage" },
          readOnly: true,
          timeoutMs: 300_000,
        },
      ];
    case "reviewer":
      return [
        {
          name: "review_diff",
          description: "Summarize working tree diff",
          invoke: { type: "cli", command: "git diff --stat" },
          readOnly: true,
          timeoutMs: 30_000,
        },
        {
          name: "review_status",
          description: "Git status short",
          invoke: { type: "cli", command: "git status -sb" },
          readOnly: true,
          timeoutMs: 15_000,
        },
      ];
    case "shell":
      return [
        {
          name: "run_shell",
          description: "Run an arbitrary shell command",
          invoke: { type: "cli", command: "{command}" },
          readOnly: false,
          timeoutMs: 120_000,
        },
      ];
    default:
      return [
        {
          name: "pane_echo",
          description: `Identify pane role ${id}`,
          invoke: { type: "cli", command: `echo LATM:${role}:${id}` },
          readOnly: true,
          timeoutMs: 5_000,
        },
      ];
  }
}

export function buildLatmManifest(options: {
  paneId: string;
  workspaceId: string;
  role: string;
  agentId?: string;
  tools?: LatmTool[];
  ttlMs?: number;
  now?: () => Date;
}): LatmManifest {
  const agentId = options.agentId || options.role;
  return {
    schemaVersion: LATM_SCHEMA_VERSION,
    agentId,
    paneId: options.paneId,
    workspaceId: options.workspaceId,
    role: options.role,
    tools: options.tools ?? latmToolsForRole(options.role, agentId),
    ttlMs: options.ttlMs ?? DEFAULT_LATM_TTL_MS,
    updatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}

export async function writeLatmManifest(
  manifest: LatmManifest,
  home: string = homeDir()
): Promise<string> {
  const path = herdrLatmManifestPath(manifest.paneId, home);
  ensureDir(join(path, ".."));
  await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return path;
}

async function readLatmManifestFile(path: string): Promise<LatmManifest | null> {
  if (!(await Bun.file(path).exists())) return null;
  let raw: unknown;
  try {
    raw = await readJsonFile(path);
  } catch {
    return null;
  }
  return isLatmManifest(raw) ? raw : null;
}

export async function discoverTools(home: string = homeDir()): Promise<DiscoveredTool[]> {
  const tools: DiscoveredTool[] = [];
  const now = Date.now();
  const root = herdrAgentsDir(home);
  if (!pathExists(root)) return tools;

  for await (const relative of new Bun.Glob("*/capabilities.json").scan({
    cwd: root,
    onlyFiles: true,
  })) {
    const fullPath = join(root, relative);
    const manifest = await readLatmManifestFile(fullPath);
    if (!manifest) continue;

    const ageMs = now - new Date(manifest.updatedAt).getTime();
    const stale = ageMs > manifest.ttlMs;

    for (const tool of manifest.tools) {
      tools.push({
        ...tool,
        agentId: manifest.agentId,
        paneId: manifest.paneId,
        workspaceId: manifest.workspaceId,
        role: manifest.role,
        manifestPath: fullPath,
        ageMs,
        stale,
      });
    }
  }

  return tools.sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? 1 : -1;
    if (a.role !== b.role) return a.role.localeCompare(b.role);
    return a.name.localeCompare(b.name);
  });
}

export async function buildLatmListReport(home: string = homeDir()): Promise<LatmListReport> {
  const tools = await discoverTools(home);
  return {
    schemaVersion: 1,
    toolCount: tools.length,
    staleCount: tools.filter((tool) => tool.stale).length,
    tools,
  };
}

function latmRolePriority(role: string): number {
  return LATM_INVOKE_ROLE_PRIORITY[role] ?? 99;
}

function sortInvokeCandidates(candidates: DiscoveredTool[]): DiscoveredTool[] {
  return [...candidates].sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? 1 : -1;
    const roleDelta = latmRolePriority(a.role) - latmRolePriority(b.role);
    if (roleDelta !== 0) return roleDelta;
    return a.ageMs - b.ageMs;
  });
}

/** Pick the best pane for a tool name (prefers shell/reviewer over agent panes). */
export function pickInvokePane(toolName: string, tools: DiscoveredTool[]): DiscoveredTool | null {
  const matches = tools.filter((tool) => tool.name === toolName);
  if (!matches.length) return null;

  const writable = matches.filter((tool) => !tool.readOnly);
  if (writable.length) {
    const shells = writable.filter((tool) => tool.role === "shell");
    const pool = shells.length ? shells : writable;
    return sortInvokeCandidates(pool)[0] ?? null;
  }

  return sortInvokeCandidates(matches)[0] ?? null;
}

/** Remove manifests for panes no longer live or bound to another workspace. */
export async function pruneLatmManifests(options: {
  activePaneIds: Iterable<string>;
  workspaceId?: string;
  home?: string;
}): Promise<{ removed: string[] }> {
  const home = options.home ?? homeDir();
  const active = new Set(options.activePaneIds);
  const removed: string[] = [];
  const root = herdrAgentsDir(home);
  if (!pathExists(root)) return { removed };

  for await (const relative of new Bun.Glob("*/capabilities.json").scan({
    cwd: root,
    onlyFiles: true,
  })) {
    const paneDir = relative.split("/")[0];
    if (!paneDir) continue;
    const fullPath = join(root, relative);
    const manifest = await readLatmManifestFile(fullPath);
    const paneId = manifest?.paneId ?? paneDir;
    const orphanPane = !active.has(paneId);
    const wrongWorkspace =
      options.workspaceId !== undefined &&
      manifest !== null &&
      manifest.workspaceId !== options.workspaceId;
    if (!orphanPane && !wrongWorkspace) continue;

    const dir = join(root, paneDir);
    removePath(dir, { recursive: true, force: true });
    removed.push(dir);
  }

  return { removed };
}

function extractJsonBlob(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through — scan for last JSON object in scrollback
  }

  const lines = trimmed.split("\n").reverse();
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

function readPaneRecentOutput(
  paneId: string,
  lines: number,
  session?: string
): { ok: true; text: string } | { ok: false; error: string } {
  const read = execCli(
    "herdr",
    ["pane", "read", paneId, "--source", "recent", "--lines", String(lines)],
    { session, timeout: 10_000 }
  );
  if (!read.ok) return { ok: false, error: read.output || "pane read failed" };
  return { ok: true, text: read.output };
}

function stripLatmMarker(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.includes(LATM_DONE_MARKER))
    .join("\n")
    .trim();
}

function waitPaneOutput(
  paneId: string,
  match: string,
  timeoutMs: number,
  session?: string
): { ok: true } | { ok: false; error: string } {
  const waited = execCli(
    "herdr",
    ["wait", "output", paneId, "--match", match, "--timeout", String(timeoutMs)],
    { session, timeout: timeoutMs + 5_000 }
  );
  return waited.ok ? { ok: true } : { ok: false, error: waited.output || "wait-output failed" };
}

export async function invokeTool(
  paneId: string,
  toolName: string,
  input: Record<string, unknown> = {},
  options: { home?: string; session?: string } = {}
): Promise<LatmInvokeResult> {
  const home = options.home ?? homeDir();
  const manifestPath = herdrLatmManifestPath(paneId, home);
  const manifest = await readLatmManifestFile(manifestPath);
  if (!manifest) {
    throw new Error(`No LATM manifest for pane ${paneId} (${manifestPath})`);
  }

  const tool = manifest.tools.find((entry) => entry.name === toolName);
  if (!tool) {
    throw new Error(`Tool ${toolName} not found on pane ${paneId}`);
  }
  if (tool.invoke.type !== "cli") {
    throw new Error(`Invoke type ${tool.invoke.type} not yet implemented for ${toolName}`);
  }

  const command = substituteLatmCommand(tool.invoke.command, input);
  const markedCommand = `(${command}); echo ${LATM_DONE_MARKER}`;
  const ran = paneRunSync(paneId, markedCommand, options.session);
  if (!ran.ok) {
    return {
      tool: toolName,
      paneId,
      exitCode: 1,
      output: { error: ran.error },
      raw: ran.error,
    };
  }

  waitPaneOutput(paneId, LATM_DONE_MARKER, tool.timeoutMs, options.session);

  const read = readPaneRecentOutput(paneId, 200, options.session);
  const raw = read.ok ? stripLatmMarker(read.text) : "";
  const parsed = read.ok ? extractJsonBlob(raw) : null;

  return {
    tool: toolName,
    paneId,
    exitCode: 0,
    output: parsed ?? { raw },
    raw: raw || undefined,
  };
}

function resolvePaneRole(
  pane: { pane_id?: string; agent?: string; title?: string; label?: string },
  config: HerdrProjectConfig
): { role: string; agentId: string } {
  const label = String(pane.label || pane.title || "").toLowerCase();
  const agent = typeof pane.agent === "string" ? pane.agent : "";

  const tab = (config.tabs || []).find((entry) => entry.label?.toLowerCase() === label);
  if (tab?.label === "doctor") return { role: "doctor", agentId: "doctor" };
  if (tab?.label === "test") return { role: "test", agentId: "test-agent" };
  if (tab?.label === "reviewer") return { role: "reviewer", agentId: "reviewer" };
  if (tab?.label === "shell") return { role: "shell", agentId: "shell" };

  const agentsPane = (config.agentsTab?.panes || []).find((entry) => {
    if (entry.role === "primary" && agent === entry.agent) return true;
    if (entry.role === "secondary" && agent === entry.agent) return true;
    if (entry.role === "shell" && !agent) return label === "shell" || label === "";
    return false;
  });
  if (agentsPane?.role === "primary") return { role: "primary", agentId: agent || "primary" };
  if (agentsPane?.role === "secondary") return { role: "secondary", agentId: agent || "secondary" };
  if (agentsPane?.role === "shell") return { role: "shell", agentId: "shell" };

  if (agent === "kimi") return { role: "primary", agentId: "kimi" };
  if (agent === "codex") return { role: "secondary", agentId: "codex" };
  if (agent.includes("test")) return { role: "test", agentId: agent || "test-agent" };
  if (label.includes("doctor")) return { role: "doctor", agentId: "doctor" };
  if (label.includes("reviewer")) return { role: "reviewer", agentId: "reviewer" };
  if (!agent) return { role: "shell", agentId: "shell" };
  return { role: "secondary", agentId: agent };
}

/** Project workspace for LATM sync — uses shared best-match picker. */
export function resolveLatmSyncWorkspace(config: HerdrProjectConfig): string | null {
  return findWorkspaceForProject(config).workspaceId;
}

/** Write capabilities.json for each pane in a workspace after bootstrap. */
export async function syncLatmManifestsForWorkspace(
  config: HerdrProjectConfig,
  workspaceId: string,
  home: string = homeDir()
): Promise<{ written: string[]; skipped: string[]; pruned: string[] }> {
  const listed = execCliJson("herdr", ["pane", "list", "--workspace", workspaceId], config.session);
  const written: string[] = [];
  const skipped: string[] = [];

  if (!listed.ok) return { written, skipped: ["pane_list_failed"], pruned: [] };

  const panes = (listed.json?.result?.panes || []) as Array<{
    pane_id?: string;
    workspace_id?: string;
    agent?: string;
    title?: string;
    label?: string;
  }>;

  const activePaneIds: string[] = [];
  for (const pane of panes) {
    const paneId = pane.pane_id;
    if (!paneId) continue;
    activePaneIds.push(paneId);
    const { role, agentId } = resolvePaneRole(pane, config);
    const manifest = buildLatmManifest({
      paneId,
      workspaceId: pane.workspace_id || workspaceId,
      role,
      agentId,
    });
    const path = await writeLatmManifest(manifest, home);
    written.push(path);
  }

  const { removed: pruned } = await pruneLatmManifests({
    activePaneIds,
    workspaceId,
    home,
  });

  if (!panes.length) skipped.push("no_panes");
  return { written, skipped, pruned };
}

export async function printLatmListHuman(report: LatmListReport): Promise<void> {
  await writeStdoutLine(`\n${report.toolCount} tools discovered across LATM`);
  const byRole = Map.groupBy(report.tools, (tool) => tool.role);
  for (const [role, list] of byRole) {
    const staleCount = list.filter((tool) => tool.stale).length;
    const status = staleCount > 0 ? ` (${staleCount} stale)` : "";
    await writeStdoutLine(`\n[${role}]${status}`);
    for (const tool of list) {
      const ro = tool.readOnly ? "R" : "W";
      const age =
        tool.ageMs > 60_000
          ? `${Math.round(tool.ageMs / 60_000)}m`
          : `${Math.round(tool.ageMs / 1000)}s`;
      const desc = tool.description.slice(0, 40);
      await writeStdoutLine(
        `  ${ro} ${tool.name.padEnd(24)} ${tool.paneId.padEnd(8)} ${desc} (${age})`
      );
    }
  }
  await writeStdoutLine("");
}
