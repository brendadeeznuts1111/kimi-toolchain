#!/usr/bin/env bun
import { discoverHerdrProjectConfig } from "../lib/herdr-project-config.ts";
import {
  bootstrapHerdrProject,
  findWorkspaceForProject,
  resolveHerdrProjectPath,
  scaffoldHerdrProject,
} from "../lib/herdr-project-runner.ts";

function parseArgs(argv: string[]) {
  const args = [...argv];
  const flags = {
    json: args.includes("--json"),
    attach: args.includes("--attach"),
    force: args.includes("--force"),
    help: args.includes("--help") || args.includes("-h"),
  };
  const positionals = args.filter((arg) => !arg.startsWith("-"));
  return { flags, command: positionals[0] || "bootstrap", path: positionals[1] || process.cwd() };
}

function printHelp() {
  console.log(`herdr-project <command> [path] [flags]

Commands:
  bootstrap   Create/focus project workspace and start configured agents
  discover    Print resolved project Herdr config
  has-config  Exit 0 when an enabled project profile exists
  status      Show whether a workspace already exists for the project
  scaffold    Write .dx/herdr.toml from the DX template

Flags:
  --json      JSON output
  --attach    After bootstrap, run herdr attach (when not already inside Herdr)
  --force     Re-run bootstrap/tab commands on an existing workspace; overwrite on scaffold
`);
}

const { flags, command, path: rawPath } = parseArgs(process.argv.slice(2));
if (flags.help) {
  printHelp();
  process.exit(0);
}

try {
  const projectPath = resolveHerdrProjectPath(rawPath);
  const configForDiscover = discoverHerdrProjectConfig(projectPath, { includeDisabled: true });
  const config = discoverHerdrProjectConfig(projectPath);

  if (command === "has-config") {
    const ok = Boolean(configForDiscover?.enabled);
    if (flags.json) {
      console.log(
        JSON.stringify(
          { ok, projectPath, configPath: configForDiscover?.sourcePath || null },
          null,
          2
        )
      );
    }
    process.exit(ok ? 0 : 1);
  }

  if (command === "discover") {
    if (!configForDiscover) {
      if (flags.json) console.log(JSON.stringify({ projectPath, config: null }, null, 2));
      else console.log(`No Herdr project config in ${projectPath}`);
      process.exit(1);
    }
    if (flags.json) console.log(JSON.stringify({ projectPath, config: configForDiscover }, null, 2));
    else {
      console.log(`Project: ${projectPath}`);
      console.log(`Config: ${configForDiscover.sourcePath}`);
      console.log(`Label: ${configForDiscover.workspaceLabel || "(auto)"}`);
      console.log(`Primary: ${configForDiscover.primaryAgent || "(none)"}`);
      console.log(
        `Secondary: ${(configForDiscover.secondaryAgents || []).join(", ") || "(none)"}`
      );
    }
    process.exit(0);
  }

  if (command === "status") {
    if (!configForDiscover) {
      const payload = { projectPath, configured: false, workspaceId: null };
      if (flags.json) console.log(JSON.stringify(payload, null, 2));
      else console.log("No project Herdr config");
      process.exit(1);
    }
    const match = findWorkspaceForProject({ ...configForDiscover, projectPath });
    const payload = {
      projectPath,
      configured: true,
      configPath: configForDiscover.sourcePath,
      workspaceId: match.workspaceId,
      matchReason: match.reason,
    };
    if (flags.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`Project: ${projectPath}`);
      console.log(`Config: ${configForDiscover.sourcePath}`);
      console.log(`Workspace: ${match.workspaceId || "(not open)"} (${match.reason})`);
    }
    process.exit(0);
  }

  if (command === "scaffold") {
    const result = scaffoldHerdrProject(projectPath, flags.force);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${result.message}: ${result.path}`);
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "bootstrap") {
    if (!config?.enabled) {
      const message = `No enabled Herdr project config in ${projectPath}`;
      if (flags.json) console.log(JSON.stringify({ ok: false, message }, null, 2));
      else console.error(message);
      process.exit(1);
    }
    const report = bootstrapHerdrProject(
      { ...config, projectPath },
      { attach: flags.attach, force: flags.force }
    );
    if (flags.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Bootstrapped ${projectPath}`);
      console.log(`Workspace: ${report.workspaceId || "(unknown)"}`);
      for (const action of report.actions) console.log(`- ${action.action}`);
      if (report.warnings.length) console.log(`Warnings: ${report.warnings.join("; ")}`);
    }
    process.exit(report.readiness.ready ? 0 : 2);
  }

  printHelp();
  process.exit(2);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (flags.json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(message);
  process.exit(1);
}