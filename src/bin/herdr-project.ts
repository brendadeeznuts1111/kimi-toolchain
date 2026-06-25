#!/usr/bin/env bun
import { isDirectRun } from "../lib/bun-utils.ts";
import { writeStdoutLine } from "../lib/cli-contract.ts";
import { Effect } from "effect";
import { discoverHerdrProjectConfig } from "../lib/herdr-project-config.ts";
import { reconcileHerdrProjectEffect } from "../lib/herdr-project-reconcile.ts";
import { requireSessionRunning } from "../lib/herdr-session-preflight.ts";
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
    apply: args.includes("--apply"),
    closeOrphans: args.includes("--close-orphans"),
    fixAgents: args.includes("--fix-agents"),
    forceLayout: args.includes("--force-layout"),
    help: args.includes("--help") || args.includes("-h"),
  };
  const positionals = args.filter((arg) => !arg.startsWith("-"));
  return { flags, command: positionals[0] || "bootstrap", path: positionals[1] || process.cwd() };
}

async function writeOut(line = ""): Promise<void> {
  await writeStdoutLine(line);
}

function writeErr(line: string): void {
  process.stderr.write(`${line}\n`);
}

interface ReconcileCliFlags {
  apply: boolean;
  closeOrphans: boolean;
  fixAgents: boolean;
  forceLayout: boolean;
}

function resolveReconcileFlags(flags: ReconcileCliFlags): ReconcileCliFlags {
  if (flags.forceLayout && !flags.closeOrphans) {
    writeErr("[reconcile] --force-layout implies --close-orphans");
    return { ...flags, closeOrphans: true };
  }
  return flags;
}

async function writeJson(value: unknown): Promise<void> {
  await writeOut(JSON.stringify(value, null, 2));
}

async function printHelp() {
  await writeOut(`herdr-project <command> [path] [flags]

Commands:
  bootstrap   Create/focus project workspace and start configured agents
  discover    Print resolved project Herdr config
  has-config  Exit 0 when an enabled project profile exists
  status      Show whether a workspace already exists for the project
  reconcile   Diff live Herdr layout against project [herdr] profile
  scaffold    Write .dx/herdr.toml from the DX template

Flags:
  --json            JSON output
  --attach          After bootstrap, run herdr attach (when not already inside Herdr)
  --force           Re-run bootstrap/tab commands on an existing workspace; overwrite on scaffold
  --apply           Apply reconcile fixes (default: dry-run)
  --close-orphans   Close orphan agent panes and extra/duplicate tabs (with --apply)
  --fix-agents      Respawn primary agent when the primary slot has the wrong agent (with --apply)
  --force-layout    Rebuild drifted tabs via layout.apply (with --apply; destroys scrollback)
`);
}

if (isDirectRun(import.meta.path)) {
  const { flags, command, path: rawPath } = parseArgs(Bun.argv.slice(2));
  if (flags.help) {
    await printHelp();
    process.exit(0);
  }

  try {
    const projectPath = resolveHerdrProjectPath(rawPath);
    const configForDiscover = discoverHerdrProjectConfig(projectPath, { includeDisabled: true });
    const config = discoverHerdrProjectConfig(projectPath);

    if (command === "has-config") {
      const ok = Boolean(configForDiscover?.enabled);
      if (flags.json) {
        await writeJson({ ok, projectPath, configPath: configForDiscover?.sourcePath || null });
      }
      process.exit(ok ? 0 : 1);
    }

    if (command === "discover") {
      if (!configForDiscover) {
        if (flags.json) await writeJson({ projectPath, config: null });
        else await writeOut(`No Herdr project config in ${projectPath}`);
        process.exit(1);
      }
      if (flags.json) await writeJson({ projectPath, config: configForDiscover });
      else {
        await writeOut(`Project: ${projectPath}`);
        await writeOut(`Config: ${configForDiscover.sourcePath}`);
        await writeOut(`Label: ${configForDiscover.workspaceLabel || "(auto)"}`);
        await writeOut(`Primary: ${configForDiscover.primaryAgent || "(none)"}`);
        await writeOut(
          `Secondary: ${(configForDiscover.secondaryAgents || []).join(", ") || "(none)"}`
        );
      }
      process.exit(0);
    }

    if (command === "status") {
      if (!configForDiscover) {
        const payload = { projectPath, configured: false, workspaceId: null };
        if (flags.json) await writeJson(payload);
        else await writeOut("No project Herdr config");
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
      if (flags.json) await writeJson(payload);
      else {
        await writeOut(`Project: ${projectPath}`);
        await writeOut(`Config: ${configForDiscover.sourcePath}`);
        await writeOut(`Workspace: ${match.workspaceId || "(not open)"} (${match.reason})`);
      }
      process.exit(0);
    }

    if (command === "scaffold") {
      const result = scaffoldHerdrProject(projectPath, flags.force);
      if (flags.json) await writeJson(result);
      else await writeOut(`${result.message}: ${result.path}`);
      process.exit(result.ok ? 0 : 1);
    }

    if (command === "reconcile") {
      if (!config?.enabled) {
        const message = `No enabled Herdr project config in ${projectPath}`;
        if (flags.json) await writeJson({ ok: false, message });
        else writeErr(message);
        process.exit(1);
      }
      await requireSessionRunning(config.session);
      const reconcileFlags = resolveReconcileFlags({
        apply: flags.apply,
        closeOrphans: flags.closeOrphans,
        fixAgents: flags.fixAgents,
        forceLayout: flags.forceLayout,
      });
      const report = await Effect.runPromise(
        reconcileHerdrProjectEffect({ ...config, projectPath }, reconcileFlags)
      );
      if (flags.json) await writeJson(report);
      else {
        await writeOut(`Reconcile ${projectPath} (${report.dryRun ? "dry-run" : "apply"})`);
        await writeOut(`Workspace: ${report.workspaceId || "(not open)"}`);
        if (report.layoutDrifts.length) {
          await writeOut("Layout drifts:");
          for (const drift of report.layoutDrifts) {
            await writeOut(`- ${drift.tabLabel}: ${drift.reason}`);
          }
        }
        for (const action of report.actions) {
          await writeOut(`${action.type.toUpperCase()}  ${action.target}: ${action.reason}`);
        }
        if (report.applied.length) {
          await writeOut("Applied:");
          for (const action of report.applied) {
            await writeOut(`- ${action.type} ${action.target}`);
          }
        }
        if (report.warnings.length) await writeOut(`Warnings: ${report.warnings.join("; ")}`);
      }
      process.exit(
        report.drift && report.dryRun ? 1 : report.warnings.length && flags.apply ? 2 : 0
      );
    }

    if (command === "bootstrap") {
      if (!config?.enabled) {
        const message = `No enabled Herdr project config in ${projectPath}`;
        if (flags.json) await writeJson({ ok: false, message });
        else writeErr(message);
        process.exit(1);
      }
      await requireSessionRunning(config.session);
      const report = await bootstrapHerdrProject(
        { ...config, projectPath },
        { attach: flags.attach, force: flags.force }
      );
      if (flags.json) await writeJson(report);
      else {
        await writeOut(`Bootstrapped ${projectPath}`);
        await writeOut(`Workspace: ${report.workspaceId || "(unknown)"}`);
        for (const action of report.actions) await writeOut(`- ${action.action}`);
        if (report.warnings.length) await writeOut(`Warnings: ${report.warnings.join("; ")}`);
      }
      process.exit(report.readiness.ready ? 0 : 2);
    }

    await printHelp();
    process.exit(2);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (flags.json) await writeJson({ ok: false, error: message });
    else writeErr(message);
    process.exit(1);
  }
}
