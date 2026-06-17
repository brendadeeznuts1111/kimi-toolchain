import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { resolveAgentArgv } from "./herdr-agents.ts";
import {
  execCli,
  execCliJson,
  herdrCliJson,
  herdrCliRun,
  resolveHerdrPanePath,
} from "./herdr-project-cli.ts";
import { paneRunSync, splitPaneSync } from "./herdr-pane-service.ts";
import { createWorkspaceSync, focusWorkspaceSync } from "./herdr-workspace-service.ts";
import { syncAgentsTabContext } from "./herdr-project-context.ts";
import type { HerdrProjectConfig } from "./herdr-project-config.ts";
import { findWorkspaceForProject } from "./herdr-workspace-match.ts";

export { findAllWorkspacesForProject, findWorkspaceForProject } from "./herdr-workspace-match.ts";
import { verifyPaneRequirements, type PaneRequirementSpec } from "./herdr-pane-requires.ts";
import { parseHerdrTabId, runTabCommand, tabCommandStrategy } from "./herdr-role-tab.ts";
import { homeDir } from "./paths.ts";

export { herdrCliJson, herdrCliRun, resolveHerdrPanePath };

export function resolveHerdrProjectPath(path: string): string {
  const root = isAbsolute(path) ? normalize(path) : resolve(process.cwd(), path);
  if (!existsSync(root)) throw new Error(`project path not found: ${root}`);
  return root;
}

function listPanes(session = "") {
  return herdrCliJson(session, ["pane", "list"]);
}

function listAgents(session = "") {
  return herdrCliJson(session, ["agent", "list"]);
}

function workspacePanes(config: HerdrProjectConfig, workspaceId: string) {
  const panes = listPanes(config.session);
  if (!panes.ok) return [];
  const rows = (panes.json?.result?.panes || []) as Array<{
    workspace_id?: string;
    pane_id?: string;
    agent?: string;
  }>;
  return rows.filter((pane) => pane.workspace_id === workspaceId);
}

function isKnownAgentPane(pane: { agent?: string }) {
  return typeof pane.agent === "string" && pane.agent.length > 0;
}

function findShellPane(config: HerdrProjectConfig, workspaceId: string) {
  return workspacePanes(config, workspaceId).find((pane) => !isKnownAgentPane(pane)) || null;
}

export function parseHerdrPaneId(
  payload: { result?: Record<string, unknown> } | null,
  fallback: string | null
) {
  const result = payload?.result;
  const pane = result?.pane as { pane_id?: string } | undefined;
  const rootPane = (result?.root_pane || result?.rootPane) as { pane_id?: string } | undefined;
  return pane?.pane_id || rootPane?.pane_id || fallback || null;
}

function agentRunning(
  agents: { json?: { result?: { agents?: Array<Record<string, string>> } } },
  label: string,
  cwd: string,
  workspaceId: string | null = null
) {
  const rows = agents.json?.result?.agents || [];
  return rows.some((agent) => {
    const nameMatch = agent.agent === label || agent.name === label;
    const cwdMatch = !cwd || agent.cwd === cwd || agent.foreground_cwd === cwd;
    const workspaceMatch = !workspaceId || agent.workspace_id === workspaceId;
    return nameMatch && cwdMatch && workspaceMatch;
  });
}

/** @deprecated Use paneRunSync from herdr-pane-service.ts instead. */
function paneRun(
  config: HerdrProjectConfig,
  paneId: string,
  command: string,
  _options: { skipPathPrefix?: boolean } = {}
) {
  return paneRunSync(paneId, command, config.session);
}

export function startHerdrAgent(
  config: HerdrProjectConfig,
  name: string,
  argv: string[],
  options: { workspaceId?: string; split?: string; env?: Record<string, string> } = {}
) {
  const args = ["agent", "start", name, "--cwd", config.projectPath || "", "--no-focus"];
  if (options.workspaceId) args.push("--workspace", options.workspaceId);
  if (options.split) args.push("--split", options.split);
  const panePath = resolveHerdrPanePath();
  const env: Record<string, string> = { ...options.env };
  if (panePath) env.PATH = panePath;
  for (const [key, value] of Object.entries(env)) {
    args.push("--env", `${key}=${value}`);
  }
  args.push("--", ...argv);
  return execCliJson("herdr", args, config.session);
}

/** @deprecated Use splitPaneSync from herdr-pane-service.ts instead. */
function splitPane(
  config: HerdrProjectConfig,
  paneId: string,
  direction: string,
  options: { ratio?: number; env?: Record<string, string> } = {}
) {
  return splitPaneSync(paneId, {
    direction: direction as "right" | "down",
    ratio: options.ratio,
    env: options.env,
    focus: false,
    session: config.session,
  });
}

function paneRequirementsOk(
  pane: { agent?: string; role?: string; requires?: PaneRequirementSpec[] },
  warnings: string[]
): boolean {
  if (!pane.requires?.length) return true;
  const verified = verifyPaneRequirements(pane.requires);
  if (verified.ok) return true;
  const label = pane.agent || pane.role || "pane";
  for (const check of verified.checks.filter((row) => !row.ok)) {
    warnings.push(`${label} requires ${check.spec.bin} (${check.hint || "not on PATH"})`);
  }
  return false;
}

function bootstrapFromAgentsTab(
  config: HerdrProjectConfig,
  workspaceId: string,
  rootPaneId: string,
  actions: Array<Record<string, unknown>>,
  warnings: string[]
) {
  const panes = config.agentsTab?.panes || [];
  const agents = listAgents(config.session);
  let shellPaneId: string | null = null;

  for (const pane of panes) {
    if (pane.role === "primary" && pane.agent) {
      if (!paneRequirementsOk(pane, warnings)) continue;
      const argv = resolveAgentArgv(pane.agent);
      const already =
        agents.ok && agentRunning(agents, pane.agent, config.projectPath || "", workspaceId);
      if (!already) {
        const started = startHerdrAgent(config, pane.agent, argv, {
          workspaceId,
          env: { HERDR_ROLE: "primary", ...pane.env },
        });
        if (!started.ok) warnings.push(`primary agent failed: ${started.error}`);
        else actions.push({ action: "primary_agent_started", agent: pane.agent });
      } else {
        actions.push({ action: "primary_agent_present", agent: pane.agent });
      }
      continue;
    }

    if (pane.role === "shell") {
      const existingShell = findShellPane(config, workspaceId);
      if (existingShell?.pane_id) {
        shellPaneId = existingShell.pane_id;
        actions.push({ action: "shell_pane_present", paneId: shellPaneId });
        continue;
      }
      const split = splitPane(config, rootPaneId, pane.split || config.shellSplit || "right", {
        ratio: pane.ratio,
        env: { HERDR_ROLE: "shell", ...pane.env },
      });
      if (split.ok) {
        shellPaneId = parseHerdrPaneId(split.json, null) || shellPaneId;
        actions.push({
          action: "shell_split",
          paneId: shellPaneId,
          direction: pane.split || config.shellSplit || "right",
          ratio: pane.ratio ?? null,
        });
      } else {
        warnings.push(`shell split failed: ${split.error}`);
      }
      continue;
    }

    if (pane.role === "secondary" && pane.agent) {
      if (!paneRequirementsOk(pane, warnings)) continue;
      const argv = resolveAgentArgv(pane.agent);
      const already =
        agents.ok && agentRunning(agents, pane.agent, config.projectPath || "", workspaceId);
      if (already) {
        actions.push({ action: "secondary_agent_present", agent: pane.agent });
        continue;
      }
      const started = startHerdrAgent(config, pane.agent, argv, {
        workspaceId,
        split: pane.split || "right",
        env: { HERDR_ROLE: "secondary", ...pane.env },
      });
      if (!started.ok) warnings.push(`secondary agent ${pane.agent} failed: ${started.error}`);
      else actions.push({ action: "secondary_agent_started", agent: pane.agent });
    }
  }

  return shellPaneId;
}

export interface BootstrapProjectOptions {
  attach?: boolean;
  force?: boolean;
}

export function bootstrapHerdrProject(
  config: HerdrProjectConfig,
  options: BootstrapProjectOptions = {}
) {
  const actions: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  let workspaceId: string | null = null;
  let workspaceWasNew = false;
  const existing = findWorkspaceForProject(config);
  if (existing.workspaceId) {
    workspaceId = existing.workspaceId;
    actions.push({ action: "focus_existing", workspaceId, reason: existing.reason });
    const focus = focusWorkspaceSync(workspaceId, config.session);
    if (!focus.ok) warnings.push(`workspace focus failed: ${focus.error}`);
  } else {
    workspaceWasNew = true;
    const created = createWorkspaceSync({
      cwd: config.projectPath || undefined,
      label: config.workspaceLabel ?? undefined,
      focus: false,
      session: config.session,
    });
    if (!created.ok) throw new Error(created.error || "workspace create failed");
    workspaceId = created.workspaceId || null;
    actions.push({ action: "workspace_created", workspaceId });
  }

  const rootPaneId = workspaceId ? `${workspaceId}:p1` : null;
  let shellPaneId: string | null = rootPaneId;

  if (config.agentsTab?.panes?.length && workspaceId && rootPaneId) {
    shellPaneId =
      bootstrapFromAgentsTab(config, workspaceId, rootPaneId, actions, warnings) || shellPaneId;
  } else {
    const agents = listAgents(config.session);

    if (config.primaryAgent) {
      const argv = resolveAgentArgv(config.primaryAgent);
      const already =
        agents.ok &&
        agentRunning(agents, config.primaryAgent, config.projectPath || "", workspaceId);
      if (!already) {
        const started = startHerdrAgent(config, config.primaryAgent, argv, {
          workspaceId: workspaceId || undefined,
          env: { HERDR_ROLE: "primary" },
        });
        if (!started.ok) warnings.push(`primary agent failed: ${started.error}`);
        else actions.push({ action: "primary_agent_started", agent: config.primaryAgent });
      } else {
        actions.push({ action: "primary_agent_present", agent: config.primaryAgent });
      }
    }

    const existingShell = workspaceId ? findShellPane(config, workspaceId) : null;
    if (existingShell?.pane_id) {
      shellPaneId = existingShell.pane_id;
      actions.push({ action: "shell_pane_present", paneId: shellPaneId });
    } else if (config.shellPane && rootPaneId) {
      const split = splitPane(config, rootPaneId, config.shellSplit, {
        env: { HERDR_ROLE: "shell" },
      });
      if (split.ok) {
        shellPaneId = parseHerdrPaneId(split.json, null) || shellPaneId;
        actions.push({ action: "shell_split", paneId: shellPaneId, direction: config.shellSplit });
      } else {
        warnings.push(`shell split failed: ${split.error}`);
      }
    }

    for (const agentName of config.secondaryAgents || []) {
      const argv = resolveAgentArgv(agentName);
      const already =
        agents.ok && agentRunning(agents, agentName, config.projectPath || "", workspaceId);
      if (already) {
        actions.push({ action: "secondary_agent_present", agent: agentName });
        continue;
      }
      const started = startHerdrAgent(config, agentName, argv, {
        workspaceId: workspaceId || undefined,
        split: "right",
        env: { HERDR_ROLE: "secondary" },
      });
      if (!started.ok) warnings.push(`secondary agent ${agentName} failed: ${started.error}`);
      else actions.push({ action: "secondary_agent_started", agent: agentName });
    }
  }

  const shouldRunBootstrap = workspaceWasNew || options.force;
  for (const tab of config.tabs || []) {
    if (!shouldRunBootstrap || !tab?.command || !workspaceId) continue;
    const tabCreate = execCliJson(
      "herdr",
      [
        "tab",
        "create",
        "--workspace",
        workspaceId,
        "--no-focus",
        ...(tab.label ? ["--label", String(tab.label)] : []),
      ],
      config.session
    );
    const tabId = parseHerdrTabId(tabCreate.json);
    const tabPaneId = parseHerdrPaneId(tabCreate.json, null);
    if (!tabCreate.ok || (!tabPaneId && !tabId)) {
      warnings.push(`tab ${tab.label || "extra"} failed`);
      continue;
    }
    const ran = runTabCommand(config, workspaceId, String(tab.command), {
      tabId,
      paneId: tabPaneId,
      tabLabel: tab.label || undefined,
    });
    if (!ran.ok) warnings.push(`tab command failed: ${ran.output}`);
    else
      actions.push({
        action: "tab_bootstrapped",
        label: tab.label || null,
        command: tab.command,
        strategy: tabCommandStrategy(String(tab.command)),
      });
  }

  const bootstrapPane = shellPaneId || rootPaneId;
  if (shouldRunBootstrap) {
    const commands = (config.bootstrap || []).filter(
      (item) => typeof item === "string" && item.length
    );
    if (bootstrapPane && commands.length) {
      const script = commands.join(" && ");
      const ran = paneRun(config, bootstrapPane, script);
      if (!ran.ok) warnings.push(`bootstrap failed: ${ran.error || script}`);
      else {
        for (const command of commands) actions.push({ action: "bootstrap_command", command });
      }
    }
  } else if ((config.bootstrap || []).length) {
    actions.push({ action: "bootstrap_skipped", reason: "workspace_already_initialized" });
  }

  if (config.agentsTab?.panes?.some((pane) => pane.context?.trim() && pane.agent)) {
    const contextSync = syncAgentsTabContext(config, config.agentsTab?.panes, workspaceId);
    for (const row of contextSync.delivered) {
      actions.push({ action: "agent_context_delivered", agent: row.agent, bytes: row.bytes });
    }
    warnings.push(...contextSync.warnings);
  }

  if (workspaceId) {
    focusWorkspaceSync(workspaceId, config.session);
  }

  if (options.attach && Bun.env.HERDR_ENV !== "1") {
    const attach = execCli("herdr", [], { session: config.session });
    if (!attach.ok && !attach.output.includes("nested herdr")) {
      warnings.push(`attach: ${attach.output}`);
    } else {
      actions.push({ action: "attach" });
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectPath: config.projectPath,
    configPath: config.sourcePath,
    workspaceId,
    actions,
    warnings,
    readiness: { ready: warnings.length === 0, warnings },
  };
}

export function scaffoldHerdrProject(projectPath: string, force = false, home = homeDir()) {
  const dxDir = join(home, ".config", "dx");
  const targetDir = join(projectPath, ".dx");
  const target = join(targetDir, "herdr.toml");
  const templatePath = join(dxDir, "templates", "herdr.project.toml");
  if (existsSync(target) && !force) {
    return { ok: false, path: target, message: "already exists (use --force to overwrite)" };
  }
  mkdirSync(targetDir, { recursive: true });
  const template = readFileSync(templatePath, "utf8");
  const projectName = projectPath.split("/").filter(Boolean).pop() || "project";
  const body = template.replace(
    'workspaceLabel = "my-project"',
    `workspaceLabel = "${projectName}"`
  );
  writeFileSync(target, body, "utf8");
  return { ok: true, path: target, message: "scaffolded" };
}
