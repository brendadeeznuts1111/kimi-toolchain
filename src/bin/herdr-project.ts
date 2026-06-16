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

function writeOut(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function writeErr(line: string): void {
  process.stderr.write(`${line}\n`);
}

function writeJson(value: unknown): void {
  writeOut(JSON.stringify(value, null, 2));
}

function printHelp() {
  writeOut(`herdr-project <command> [path] [flags]

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
      writeJson({ ok, projectPath, configPath: configForDiscover?.sourcePath || null });
    }
    process.exit(ok ? 0 : 1);
  }

  if (command === "discover") {
    if (!configForDiscover) {
      if (flags.json) writeJson({ projectPath, config: null });
      else writeOut(`No Herdr project config in ${projectPath}`);
      process.exit(1);
    }
    if (flags.json) writeJson({ projectPath, config: configForDiscover });
    else {
      writeOut(`Project: ${projectPath}`);
      writeOut(`Config: ${configForDiscover.sourcePath}`);
      writeOut(`Label: ${configForDiscover.workspaceLabel || "(auto)"}`);
      writeOut(`Primary: ${configForDiscover.primaryAgent || "(none)"}`);
      writeOut(`Secondary: ${(configForDiscover.secondaryAgents || []).join(", ") || "(none)"}`);
    }
    process.exit(0);
  }

  if (command === "status") {
    if (!configForDiscover) {
      const payload = { projectPath, configured: false, workspaceId: null };
      if (flags.json) writeJson(payload);
      else writeOut("No project Herdr config");
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
    if (flags.json) writeJson(payload);
    else {
      writeOut(`Project: ${projectPath}`);
      writeOut(`Config: ${configForDiscover.sourcePath}`);
      writeOut(`Workspace: ${match.workspaceId || "(not open)"} (${match.reason})`);
    }
    process.exit(0);
  }

  if (command === "scaffold") {
    const result = scaffoldHerdrProject(projectPath, flags.force);
    if (flags.json) writeJson(result);
    else writeOut(`${result.message}: ${result.path}`);
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "bootstrap") {
    if (!config?.enabled) {
      const message = `No enabled Herdr project config in ${projectPath}`;
      if (flags.json) writeJson({ ok: false, message });
      else writeErr(message);
      process.exit(1);
    }
    const report = bootstrapHerdrProject(
      { ...config, projectPath },
      { attach: flags.attach, force: flags.force }
    );
    if (flags.json) writeJson(report);
    else {
      writeOut(`Bootstrapped ${projectPath}`);
      writeOut(`Workspace: ${report.workspaceId || "(unknown)"}`);
      for (const action of report.actions) writeOut(`- ${action.action}`);
      if (report.warnings.length) writeOut(`Warnings: ${report.warnings.join("; ")}`);
    }
    process.exit(report.readiness.ready ? 0 : 2);
  }

  printHelp();
  process.exit(2);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (flags.json) writeJson({ ok: false, error: message });
  else writeErr(message);
  process.exit(1);
}
