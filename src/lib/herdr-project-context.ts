import { execArgvSync, sleepSync } from "./bun-utils.ts";
import { pathExists, writeText } from "./bun-io.ts";
import { buildContextSyncFromReport, enrichHandoffMessage } from "./context-sync-from-report.ts";
import type { HerdrAgentsTabPane, HerdrProjectConfig } from "./herdr-project-config.ts";
import { herdrCliRun, resolveHerdrPanePath } from "./herdr-project-cli.ts";
import { findWorkspaceForProject, resolveWorkspaceAgentPaneId } from "./herdr-workspace-match.ts";

const DEFAULT_CONTEXT_FILE = "/tmp/workspace-context.md";

/** Path for the persistent context drop (HERDR_CONTEXT_FILE overrides). */
export function resolveContextFilePath(): string {
  const override = Bun.env.HERDR_CONTEXT_FILE?.trim();
  return override || DEFAULT_CONTEXT_FILE;
}

/** Write delivered context to disk for non-chat agents and manual inspection. */
export function writeContextDrop(text: string): string {
  const path = resolveContextFilePath();
  writeText(path, text);
  return path;
}

function pauseSync(ms: number) {
  try {
    sleepSync(ms);
  } catch {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {}
  }
}

/** Run a context command in the project directory and return trimmed stdout. */
export function runContextCommand(projectPath: string, command: string, timeout = 60_000): string {
  const path = resolveHerdrPanePath();
  const payload = path
    ? `export PATH="${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"; ${command}`
    : command;
  try {
    return execArgvSync("sh", ["-lc", payload], { cwd: projectPath, timeout });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    const output = `${err.stdout || ""}${err.stderr || ""}`.trim();
    throw new Error(output || "context command failed");
  }
}

function resolveAgentSendTarget(
  config: HerdrProjectConfig,
  agentName: string,
  workspaceId?: string | null
): string | null {
  const resolvedWorkspace = workspaceId ?? findWorkspaceForProject(config).workspaceId;
  const paneId = resolveWorkspaceAgentPaneId(config, agentName, resolvedWorkspace);
  if (paneId) return paneId;
  return null;
}

function sendAgentText(config: HerdrProjectConfig, target: string, text: string) {
  return herdrCliRun(config.session, ["agent", "send", target, text], 30_000);
}

function deliverContextWithRetry(
  config: HerdrProjectConfig,
  agentName: string,
  text: string,
  workspaceId?: string | null,
  attempts = 3
): { ok: boolean; error?: string; target?: string } {
  const target = resolveAgentSendTarget(config, agentName, workspaceId);
  if (!target) {
    const ws = workspaceId ?? findWorkspaceForProject(config).workspaceId ?? "?";
    return {
      ok: false,
      error: `no pane for agent ${agentName} in workspace ${ws} (refuse bare agent label)`,
    };
  }
  let lastError = "agent send failed";
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) pauseSync(600);
    const sent = sendAgentText(config, target, text);
    if (sent.ok) return { ok: true, target };
    lastError = sent.output || lastError;
  }
  return { ok: false, error: lastError, target };
}

export interface SyncAgentsTabContextResult {
  delivered: Array<{ agent: string; bytes: number }>;
  warnings: string[];
  /** Set when at least one delivery also wrote the context file drop. */
  contextFile?: string;
  contextJsonFile?: string;
}

export interface SyncAgentsTabContextOptions {
  /** Append v1.1 finish-work report brief when present (workspace.updated path). */
  appendFinishWorkBrief?: boolean;
}

/** Deliver pane.context output to running agents via `herdr agent send`. */
export function syncAgentsTabContext(
  config: HerdrProjectConfig,
  panes: HerdrAgentsTabPane[] | undefined = config.agentsTab?.panes,
  workspaceId?: string | null,
  options: SyncAgentsTabContextOptions = {}
): SyncAgentsTabContextResult {
  const delivered: Array<{ agent: string; bytes: number }> = [];
  const warnings: string[] = [];
  let contextFile: string | undefined;
  let contextJsonFile: string | undefined;
  const projectPath = config.projectPath || "";
  if (!projectPath || !panes?.length) return { delivered, warnings };

  const resolvedWorkspace = workspaceId ?? findWorkspaceForProject(config).workspaceId;
  if (!resolvedWorkspace) {
    warnings.push(`workspace not open for ${projectPath}`);
    return { delivered, warnings };
  }

  for (const pane of panes) {
    if (!pane.context?.trim() || !pane.agent) continue;
    let text = "";
    try {
      text = runContextCommand(projectPath, pane.context.trim());
    } catch (error) {
      warnings.push(
        `context command for ${pane.agent} failed: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
    if (!text) {
      warnings.push(`context command for ${pane.agent} produced no output`);
      continue;
    }
    if (options.appendFinishWorkBrief && projectPath) {
      const payload = buildContextSyncFromReport(projectPath);
      if (payload) {
        text = enrichHandoffMessage(text, payload);
      }
    }
    const result = deliverContextWithRetry(config, pane.agent, text, resolvedWorkspace);
    if (result.ok) {
      delivered.push({ agent: pane.agent, bytes: text.length });
      try {
        contextFile = writeContextDrop(text);
        if (pane.context.includes("--write-context-files") || pane.context.includes("--json")) {
          const jsonPath = Bun.env.HERDR_CONTEXT_JSON_FILE?.trim() || "/tmp/workspace-context.json";
          if (pathExists(jsonPath)) contextJsonFile = jsonPath;
        }
      } catch (error) {
        warnings.push(
          `context file drop failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else {
      warnings.push(`agent send ${pane.agent} failed: ${result.error}`);
    }
  }

  return { delivered, warnings, contextFile, contextJsonFile };
}
