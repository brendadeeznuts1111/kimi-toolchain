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
import { syncAgentsTabContext } from "./herdr-project-context.ts";
import type { HerdrProjectConfig } from "./herdr-project-config.ts";
import { homeDir } from "./paths.ts";

export { herdrCliJson, herdrCliRun, resolveHerdrPanePath };

export function resolveHerdrProjectPath(path: string): string {
  const root = isAbsolute(path) ? normalize(path) : resolve(process.cwd(), path);
  if (!existsSync(root)) throw new Error(`project path not found: ${root}`);
  return root;
}

function herdrArgs(session: string) {
  return session ? ["--session", session] : [];
}

function listWorkspaces(session = "") {
  return execCliJson("herdr", [...herdrArgs(session), "workspace", "list"]);
}

function listPanes(session = "") {
  return execCliJson("herdr", [...herdrArgs(session), "pane", "list"]);
}

function listAgents(session = "") {
  return execCliJson("herdr", [...herdrArgs(session), "agent", "list"]);
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

export function findWorkspaceForProject(config: HerdrProjectConfig) {
  const panes = listPanes(config.session);
  if (!panes.ok) return { workspaceId: null as string | null, reason: panes.error };
  const projectPath = config.projectPath || "";
  const label = config.workspaceLabel;
  const paneRows = (panes.json?.result?.panes || []) as Array<{
    workspace_id?: string;
    cwd?: string;
    foreground_cwd?: string;
  }>;
  const byCwd = paneRows.find(
    (pane) => pane.cwd === projectPath || pane.foreground_cwd === projectPath
  );
  if (byCwd?.workspace_id) return { workspaceId: byCwd.workspace_id, reason: "cwd" };
  if (label) {
    const workspaces = listWorkspaces(config.session);
    if (workspaces.ok) {
      const match = (
        workspaces.json?.result?.workspaces as Array<{ label?: string; workspace_id?: string }>
      )?.find((ws) => ws.label === label);
      if (match?.workspace_id) return { workspaceId: match.workspace_id, reason: "label" };
    }
  }
  return { workspaceId: null, reason: "not_found" };
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

function shellQuote(value: string) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function paneRun(
  config: HerdrProjectConfig,
  paneId: string,
  command: string,
  options: { skipPathPrefix?: boolean } = {}
) {
  let payload = command;
  if (!options.skipPathPrefix) {
    const path = resolveHerdrPanePath();
    if (path) {
      const escapedPath = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      payload = `export PATH="${escapedPath}"; ${command}`;
    }
  }
  return execCli("herdr", [
    ...herdrArgs(config.session),
    "pane",
    "run",
    paneId,
    `sh -lc ${shellQuote(payload)}`,
  ]);
}

export function startHerdrAgent(
  config: HerdrProjectConfig,
  name: string,
  argv: string[],
  options: { workspaceId?: string; split?: string; env?: Record<string, string> } = {}
) {
  const args = [
    ...herdrArgs(config.session),
    "agent",
    "start",
    name,
    "--cwd",
    config.projectPath || "",
    "--no-focus",
  ];
  if (options.workspaceId) args.push("--workspace", options.workspaceId);
  if (options.split) args.push("--split", options.split);
  const panePath = resolveHerdrPanePath();
  const env: Record<string, string> = { ...options.env };
  if (panePath) env.PATH = panePath;
  for (const [key, value] of Object.entries(env)) {
    args.push("--env", `${key}=${value}`);
  }
  args.push("--", ...argv);
  return execCliJson("herdr", args);
}

function splitPane(
  config: HerdrProjectConfig,
  paneId: string,
  direction: string,
  options: { ratio?: number; env?: Record<string, string> } = {}
) {
  const args = [
    ...herdrArgs(config.session),
    "pane",
    "split",
    paneId,
    "--direction",
    direction,
    "--no-focus",
  ];
  if (typeof options.ratio === "number") args.push("--ratio", String(options.ratio));
  for (const [key, value] of Object.entries(options.env ?? {})) {
    args.push("--env", `${key}=${value}`);
  }
  return execCliJson("herdr", args);
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
      shellPaneId = parseHerdrPaneId(split.json, null) || shellPaneId;
      if (split.ok) {
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
    const focus = execCli("herdr", [
      ...herdrArgs(config.session),
      "workspace",
      "focus",
      workspaceId,
    ]);
    if (!focus.ok) warnings.push(`workspace focus failed: ${focus.output}`);
  } else {
    workspaceWasNew = true;
    const createArgs = [
      ...herdrArgs(config.session),
      "workspace",
      "create",
      "--cwd",
      config.projectPath || "",
      "--no-focus",
    ];
    if (config.workspaceLabel) createArgs.push("--label", config.workspaceLabel);
    const created = execCliJson("herdr", createArgs);
    if (!created.ok) throw new Error(created.error || "workspace create failed");
    workspaceId =
      (created.json?.result?.workspace as { workspace_id?: string })?.workspace_id || null;
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
      shellPaneId = parseHerdrPaneId(split.json, null) || shellPaneId;
      if (split.ok) {
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
    const tabCreate = execCliJson("herdr", [
      ...herdrArgs(config.session),
      "tab",
      "create",
      "--workspace",
      workspaceId,
      "--no-focus",
      ...(tab.label ? ["--label", String(tab.label)] : []),
    ]);
    const tabPaneId = parseHerdrPaneId(tabCreate.json, null);
    if (!tabCreate.ok || !tabPaneId) {
      warnings.push(`tab ${tab.label || "extra"} failed`);
      continue;
    }
    const ran = paneRun(config, tabPaneId, String(tab.command));
    if (!ran.ok) warnings.push(`tab command failed: ${ran.output}`);
    else
      actions.push({ action: "tab_bootstrapped", label: tab.label || null, command: tab.command });
  }

  const bootstrapPane = shellPaneId || rootPaneId;
  if (shouldRunBootstrap) {
    const commands = (config.bootstrap || []).filter(
      (item) => typeof item === "string" && item.length
    );
    if (bootstrapPane && commands.length) {
      const script = commands.join(" && ");
      const ran = paneRun(config, bootstrapPane, script);
      if (!ran.ok) warnings.push(`bootstrap failed: ${ran.output || script}`);
      else {
        for (const command of commands) actions.push({ action: "bootstrap_command", command });
      }
    }
  } else if ((config.bootstrap || []).length) {
    actions.push({ action: "bootstrap_skipped", reason: "workspace_already_initialized" });
  }

  if (config.agentsTab?.panes?.some((pane) => pane.context?.trim() && pane.agent)) {
    const contextSync = syncAgentsTabContext(config);
    for (const row of contextSync.delivered) {
      actions.push({ action: "agent_context_delivered", agent: row.agent, bytes: row.bytes });
    }
    warnings.push(...contextSync.warnings);
  }

  if (workspaceId) {
    execCli("herdr", [...herdrArgs(config.session), "workspace", "focus", workspaceId]);
  }

  if (options.attach && process.env.HERDR_ENV !== "1") {
    const attach = execCli("herdr", [...herdrArgs(config.session)]);
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
