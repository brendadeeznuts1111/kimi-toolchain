import { execFileSync } from "node:child_process";
import type { HerdrAgentsTabPane, HerdrProjectConfig } from "./herdr-project-config.ts";
import { herdrCliRun, resolveHerdrPanePath } from "./herdr-project-cli.ts";

function pauseSync(ms: number) {
  try {
    execFileSync("sleep", [String(Math.max(0.1, ms / 1000))], { stdio: "ignore" });
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
    return execFileSync("sh", ["-lc", payload], {
      cwd: projectPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
    }).trim();
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    const output = `${err.stdout || ""}${err.stderr || ""}`.trim();
    throw new Error(output || "context command failed");
  }
}

function sendAgentText(config: HerdrProjectConfig, agent: string, text: string) {
  return herdrCliRun(config.session, ["agent", "send", agent, text], 30_000);
}

function deliverContextWithRetry(
  config: HerdrProjectConfig,
  agent: string,
  text: string,
  attempts = 3
): { ok: boolean; error?: string } {
  let lastError = "agent send failed";
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) pauseSync(600);
    const sent = sendAgentText(config, agent, text);
    if (sent.ok) return { ok: true };
    lastError = sent.output || lastError;
  }
  return { ok: false, error: lastError };
}

export interface SyncAgentsTabContextResult {
  delivered: Array<{ agent: string; bytes: number }>;
  warnings: string[];
}

/** Deliver pane.context output to running agents via `herdr agent send`. */
export function syncAgentsTabContext(
  config: HerdrProjectConfig,
  panes: HerdrAgentsTabPane[] | undefined = config.agentsTab?.panes
): SyncAgentsTabContextResult {
  const delivered: Array<{ agent: string; bytes: number }> = [];
  const warnings: string[] = [];
  const projectPath = config.projectPath || "";
  if (!projectPath || !panes?.length) return { delivered, warnings };

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
    const result = deliverContextWithRetry(config, pane.agent, text);
    if (result.ok) {
      delivered.push({ agent: pane.agent, bytes: text.length });
    } else {
      warnings.push(`agent send ${pane.agent} failed: ${result.error}`);
    }
  }

  return { delivered, warnings };
}
