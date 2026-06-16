import { connect } from "node:net";
import { Effect } from "effect";
import { resolveAgentArgv } from "./herdr-agents.ts";
import type {
  HerdrAgentsTab,
  HerdrAgentsTabPane,
  HerdrProjectConfig,
  HerdrProjectTab,
  HerdrShellSplit,
} from "./herdr-project-config.ts";
import { resolveHerdrPanePath } from "./herdr-project-runner.ts";

export type LayoutNodeType = "pane" | "split";

export interface LayoutPaneNode {
  type: "pane";
  label?: string;
  cwd?: string;
  command?: string[];
  env?: Record<string, string>;
  pane_id?: string;
}

export interface LayoutSplitNode {
  type: "split";
  direction: HerdrShellSplit;
  ratio?: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = LayoutPaneNode | LayoutSplitNode;

export interface TabLayoutSpec {
  tabLabel: string;
  tabId?: string;
  root: LayoutNode;
}

export interface ExportedTabLayout {
  workspaceId: string;
  tabId: string;
  tabLabel?: string;
  focusedPaneId?: string;
  root: LayoutNode;
}

export interface LayoutDrift {
  tabLabel: string;
  tabId: string | null;
  reason: string;
  expected: LayoutNode;
  actual: LayoutNode | null;
}

interface HerdrSocketResponse {
  id?: string;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

const DEFAULT_SPLIT_RATIO = 0.6;

function roundRatio(value: number | undefined): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return Math.round(value * 1000) / 1000;
}

function roleEnv(role: string, extra: Record<string, string> = {}): Record<string, string> {
  return { HERDR_ROLE: role, ...extra };
}

function agentCommand(agent: string): string[] {
  return resolveAgentArgv(agent);
}

function tabRunCommand(command: string): string[] {
  const path = resolveHerdrPanePath();
  const payload = path
    ? `export PATH="${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"; ${command}`
    : command;
  return ["sh", "-c", payload];
}

export function paneNodeFromSpec(pane: HerdrAgentsTabPane, projectPath: string): LayoutPaneNode {
  const label = pane.label || pane.role;
  const env = { ...roleEnv(pane.role, pane.env || {}) };

  if (pane.role === "shell") {
    return { type: "pane", label, cwd: projectPath, env };
  }

  if (pane.command) {
    return {
      type: "pane",
      label,
      cwd: projectPath,
      env,
      command: tabRunCommand(pane.command),
    };
  }

  if (pane.agent) {
    return {
      type: "pane",
      label: pane.agent,
      cwd: projectPath,
      env,
      command: agentCommand(pane.agent),
    };
  }

  return { type: "pane", label, cwd: projectPath, env };
}

export function buildAgentsTabLayoutTree(
  agentsTab: HerdrAgentsTab,
  projectPath: string
): LayoutNode {
  const panes = agentsTab.panes;
  if (!panes.length) {
    return { type: "pane", label: "agents", cwd: projectPath, env: roleEnv("primary") };
  }

  let tree: LayoutNode = paneNodeFromSpec(panes[0]!, projectPath);
  for (let index = 1; index < panes.length; index++) {
    const pane = panes[index]!;
    tree = {
      type: "split",
      direction: pane.split === "down" ? "down" : "right",
      ratio: roundRatio(pane.ratio ?? DEFAULT_SPLIT_RATIO),
      first: tree,
      second: paneNodeFromSpec(pane, projectPath),
    };
  }
  return tree;
}

export function buildExtraTabLayoutTree(tab: HerdrProjectTab, projectPath: string): LayoutNode {
  const label = tab.label || "tab";
  if (!tab.command) {
    return { type: "pane", label, cwd: projectPath };
  }
  return {
    type: "pane",
    label,
    cwd: projectPath,
    command: tabRunCommand(tab.command),
  };
}

export function buildLegacyAgentsTabLayout(config: HerdrProjectConfig): LayoutNode {
  const projectPath = config.projectPath || "";
  const panes: HerdrAgentsTabPane[] = [];

  if (config.primaryAgent) {
    panes.push({ role: "primary", agent: config.primaryAgent });
  }
  if (config.shellPane !== false) {
    panes.push({ role: "shell", split: config.shellSplit || "right" });
  }
  for (const agent of config.secondaryAgents || []) {
    panes.push({ role: "secondary", agent, split: "right" });
  }

  return buildAgentsTabLayoutTree({ label: "agents", panes }, projectPath);
}

export function buildIntendedTabLayouts(config: HerdrProjectConfig): TabLayoutSpec[] {
  const projectPath = config.projectPath || "";
  const layouts: TabLayoutSpec[] = [];

  if (config.agentsTab?.panes?.length) {
    layouts.push({
      tabLabel: config.agentsTab.label || "agents",
      root: buildAgentsTabLayoutTree(config.agentsTab, projectPath),
    });
  } else {
    layouts.push({
      tabLabel: "agents",
      root: buildLegacyAgentsTabLayout(config),
    });
  }

  for (const tab of config.tabs || []) {
    if (!tab.label) continue;
    layouts.push({
      tabLabel: tab.label,
      root: buildExtraTabLayoutTree(tab, projectPath),
    });
  }

  return layouts;
}

function commandFingerprint(command: string[] | undefined): string | null {
  if (!command?.length) return null;
  const joined = command.join(" ");
  const agentMatch = joined.match(/\/([^/]+)$/);
  if (agentMatch && command.length === 1) return agentMatch[1]!;
  if (command[0] === "sh" && command[1] === "-c" && typeof command[2] === "string") {
    return command[2].replace(/^export PATH="[^"]*"; /, "");
  }
  return joined;
}

export interface NormalizedLayoutNode {
  type: LayoutNodeType;
  direction?: HerdrShellSplit;
  ratio?: number;
  label?: string;
  role?: string;
  agent?: string | null;
  command?: string | null;
  cwd?: string;
  first?: NormalizedLayoutNode;
  second?: NormalizedLayoutNode;
}

export function normalizeLayoutNode(node: LayoutNode, projectPath = ""): NormalizedLayoutNode {
  if (node.type === "split") {
    return {
      type: "split",
      direction: node.direction,
      ratio: roundRatio(node.ratio),
      first: normalizeLayoutNode(node.first, projectPath),
      second: normalizeLayoutNode(node.second, projectPath),
    };
  }

  const role = node.env?.HERDR_ROLE;
  const command = commandFingerprint(node.command);
  const agent =
    role === "primary" || role === "secondary"
      ? node.label || commandFingerprint(node.command)
      : null;

  const label = node.label || role || undefined;

  return {
    type: "pane",
    label,
    role,
    agent,
    command: role === "shell" ? null : command,
    cwd: projectPath && node.cwd === projectPath ? projectPath : node.cwd,
  };
}

export function layoutTreesEqual(
  expected: LayoutNode,
  actual: LayoutNode | null | undefined,
  projectPath = ""
): boolean {
  if (!actual) return false;
  return (
    JSON.stringify(normalizeLayoutNode(expected, projectPath)) ===
    JSON.stringify(normalizeLayoutNode(actual, projectPath))
  );
}

function resolveSocketPath(): string {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH;
  const home = process.env.HOME || "";
  return `${home}/.config/herdr/herdr.sock`;
}

export type HerdrSocketResult<T> = { ok: true; json: T } | { ok: false; error: string };

export function herdrSocketRequest<T = HerdrSocketResponse>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 5_000
): Effect.Effect<HerdrSocketResult<T>, never> {
  return Effect.async<HerdrSocketResult<T>>((resume) => {
    const socketPath = resolveSocketPath();
    const payload = JSON.stringify({ id: `herdr-project:${method}`, method, params }) + "\n";
    const socket = connect(socketPath);
    let buffer = "";

    const finish = (result: HerdrSocketResult<T>) => {
      socket.removeAllListeners();
      socket.end();
      resume(Effect.succeed(result));
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: `herdr socket timeout (${method})` });
    }, timeoutMs);

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    socket.on("end", () => {
      clearTimeout(timer);
      const line = buffer
        .split("\n")
        .map((row) => row.trim())
        .find(Boolean);
      if (!line) {
        finish({ ok: false, error: `empty socket response (${method})` });
        return;
      }
      try {
        const json = JSON.parse(line) as HerdrSocketResponse;
        if (json.error) {
          finish({
            ok: false,
            error: json.error.message || json.error.code || `socket error (${method})`,
          });
          return;
        }
        finish({ ok: true, json: json as T });
      } catch {
        finish({ ok: false, error: `invalid socket JSON (${method})` });
      }
    });

    socket.write(payload);
  });
}

function parseLayoutRoot(payload: Record<string, unknown> | null | undefined): LayoutNode | null {
  const layout = (payload?.layout || payload) as Record<string, unknown> | undefined;
  const root = layout?.root;
  if (!root || typeof root !== "object") return null;
  return root as LayoutNode;
}

export type ExportTabLayoutResult =
  | { ok: true; layout: ExportedTabLayout }
  | { ok: false; error: string };

export type ApplyTabLayoutResult = { ok: true; tabId: string } | { ok: false; error: string };

export function exportTabLayoutEffect(tabId: string): Effect.Effect<ExportTabLayoutResult, never> {
  return Effect.gen(function* () {
    const response = yield* herdrSocketRequest<HerdrSocketResponse>("layout.export", {
      tab_id: tabId,
    });
    if (!response.ok) return response;

    const result = response.json.result || {};
    const layout = (result.layout || result) as Record<string, unknown>;
    const root = parseLayoutRoot(layout);
    if (!root) return { ok: false as const, error: "layout.export missing root" };

    return {
      ok: true as const,
      layout: {
        workspaceId: String(layout.workspace_id || ""),
        tabId: String(layout.tab_id || tabId),
        focusedPaneId:
          typeof layout.focused_pane_id === "string" ? layout.focused_pane_id : undefined,
        root,
      },
    };
  });
}

export function applyTabLayoutEffect(options: {
  workspaceId: string;
  tabLabel: string;
  root: LayoutNode;
  tabId?: string;
  focus?: boolean;
}): Effect.Effect<ApplyTabLayoutResult, never> {
  return Effect.gen(function* () {
    const params: Record<string, unknown> = {
      workspace_id: options.workspaceId,
      tab_label: options.tabLabel,
      focus: options.focus ?? false,
      root: options.root,
    };
    if (options.tabId) params.tab_id = options.tabId;

    const response = yield* herdrSocketRequest<HerdrSocketResponse>("layout.apply", params);
    if (!response.ok) return response;

    const result = response.json.result || {};
    const layout = (result.layout || result) as Record<string, unknown>;
    const tabId = String(layout.tab_id || "");
    if (!tabId) return { ok: false as const, error: "layout.apply missing tab_id" };
    return { ok: true as const, tabId };
  });
}

export function diffTabLayouts(
  intended: TabLayoutSpec[],
  tabs: Array<{ tabId: string; label: string }>,
  exported: Map<string, ExportedTabLayout | null>,
  projectPath: string
): LayoutDrift[] {
  const drifts: LayoutDrift[] = [];
  const tabsByLabel = new Map(tabs.map((tab) => [tab.label.trim().toLowerCase(), tab]));

  for (const spec of intended) {
    const normalizedLabel = spec.tabLabel.trim().toLowerCase();
    const actualTab = tabsByLabel.get(normalizedLabel) || null;
    const exportedLayout = actualTab ? exported.get(actualTab.tabId) || null : null;
    const actualRoot = exportedLayout?.root || null;

    if (!layoutTreesEqual(spec.root, actualRoot, projectPath)) {
      drifts.push({
        tabLabel: spec.tabLabel,
        tabId: actualTab?.tabId || null,
        reason: actualTab
          ? `layout drift on tab "${spec.tabLabel}"`
          : `missing tab "${spec.tabLabel}"`,
        expected: spec.root,
        actual: actualRoot,
      });
    }
  }

  return drifts;
}
