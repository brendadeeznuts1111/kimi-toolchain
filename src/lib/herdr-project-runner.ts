import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { resolveAgentArgv } from "./herdr-agents.ts";
import type { HerdrProjectConfig } from "./herdr-project-config.ts";
import { homeDir } from "./paths.ts";

export function herdrCliRun(session: string, args: string[] = [], timeout = 30_000) {
  return run("herdr", [...herdrArgs(session), ...args], timeout);
}

export function herdrCliJson(session: string, args: string[] = []) {
  const result = herdrCliRun(session, args);
  if (!result.ok) return { ok: false as const, error: result.output, json: null };
  try {
    return { ok: true as const, json: JSON.parse(result.output), error: null };
  } catch {
    return { ok: false as const, error: "invalid JSON from herdr CLI", json: null };
  }
}

function run(cmd: string, args: string[] = [], timeout = 30_000) {
  try {
    return {
      ok: true,
      output: execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
      }).trim(),
    };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      ok: false,
      output: `${err.stdout || ""}${err.stderr || ""}`.trim(),
      code: err.status ?? 1,
    };
  }
}

function runJson(cmd: string, args: string[] = []) {
  const result = run(cmd, args);
  if (!result.ok) return { ok: false as const, error: result.output, json: null };
  try {
    return { ok: true as const, json: JSON.parse(result.output), error: null };
  } catch {
    return { ok: false as const, error: "invalid JSON from herdr CLI", json: null };
  }
}

export function resolveHerdrProjectPath(path: string): string {
  const root = isAbsolute(path) ? normalize(path) : resolve(process.cwd(), path);
  if (!existsSync(root)) throw new Error(`project path not found: ${root}`);
  return root;
}

function herdrArgs(session: string) {
  return session ? ["--session", session] : [];
}

function listWorkspaces(session = "") {
  return runJson("herdr", [...herdrArgs(session), "workspace", "list"]);
}

function listPanes(session = "") {
  return runJson("herdr", [...herdrArgs(session), "pane", "list"]);
}

function listAgents(session = "") {
  return runJson("herdr", [...herdrArgs(session), "agent", "list"]);
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

export function resolveHerdrPanePath(home = homeDir()): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    for (const entry of String(value || "").split(":")) {
      if (!entry || seen.has(entry)) continue;
      seen.add(entry);
      parts.push(entry);
    }
  };
  add(process.env.PATH);
  for (const segment of [
    `${home}/.local/bin`,
    `${home}/.kimi-code/bin`,
    `${home}/.bun/bin`,
    `${home}/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]) {
    add(segment);
  }
  return parts.join(":");
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
  return run("herdr", [
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
  options: { workspaceId?: string; split?: string } = {}
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
  if (panePath) args.push("--env", `PATH=${panePath}`);
  args.push("--", ...argv);
  return runJson("herdr", args);
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
    const focus = run("herdr", [...herdrArgs(config.session), "workspace", "focus", workspaceId]);
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
    const created = runJson("herdr", createArgs);
    if (!created.ok) throw new Error(created.error || "workspace create failed");
    workspaceId =
      (created.json?.result?.workspace as { workspace_id?: string })?.workspace_id || null;
    actions.push({ action: "workspace_created", workspaceId });
  }

  const rootPaneId = workspaceId ? `${workspaceId}:p1` : null;
  const agents = listAgents(config.session);

  if (config.primaryAgent) {
    const argv = resolveAgentArgv(config.primaryAgent);
    const already =
      agents.ok && agentRunning(agents, config.primaryAgent, config.projectPath || "", workspaceId);
    if (!already) {
      const started = startHerdrAgent(config, config.primaryAgent, argv, {
        workspaceId: workspaceId || undefined,
      });
      if (!started.ok) warnings.push(`primary agent failed: ${started.error}`);
      else actions.push({ action: "primary_agent_started", agent: config.primaryAgent });
    } else {
      actions.push({ action: "primary_agent_present", agent: config.primaryAgent });
    }
  }

  let shellPaneId = rootPaneId;
  const existingShell = workspaceId ? findShellPane(config, workspaceId) : null;
  if (existingShell?.pane_id) {
    shellPaneId = existingShell.pane_id;
    actions.push({ action: "shell_pane_present", paneId: shellPaneId });
  } else if (config.shellPane && rootPaneId) {
    const split = runJson("herdr", [
      ...herdrArgs(config.session),
      "pane",
      "split",
      rootPaneId,
      "--direction",
      config.shellSplit,
      "--no-focus",
    ]);
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
    });
    if (!started.ok) warnings.push(`secondary agent ${agentName} failed: ${started.error}`);
    else actions.push({ action: "secondary_agent_started", agent: agentName });
  }

  const shouldRunBootstrap = workspaceWasNew || options.force;
  for (const tab of config.tabs || []) {
    if (!shouldRunBootstrap || !tab?.command || !workspaceId) continue;
    const tabCreate = runJson("herdr", [
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

  if (workspaceId) {
    run("herdr", [...herdrArgs(config.session), "workspace", "focus", workspaceId]);
  }

  if (options.attach && process.env.HERDR_ENV !== "1") {
    const attach = run("herdr", [...herdrArgs(config.session)]);
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
