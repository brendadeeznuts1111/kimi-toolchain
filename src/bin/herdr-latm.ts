#!/usr/bin/env bun
/**
 * herdr-latm — Local Agent Tool Mesh
 *
 *   herdr-latm list [--json]
 *   herdr-latm invoke <pane> --tool <name> [--input <json>] [--json]
 *   herdr-latm sync [--project <path>] [--json]
 */

import {
  buildLatmListReport,
  invokeTool,
  pickInvokePane,
  printLatmListHuman,
  resolveLatmSyncWorkspace,
  syncLatmManifestsForWorkspace,
} from "../lib/herdr-latm.ts";
import { discoverHerdrProjectConfig } from "../lib/herdr-project-config.ts";
import { resolveHerdrProjectPath } from "../lib/herdr-project-runner.ts";

import { isDirectRun } from "../lib/bun-utils.ts";
import { writeStdoutLine } from "../lib/cli-contract.ts";

async function writeOut(line = ""): Promise<void> {
  await writeStdoutLine(line);
}

async function writeJson(value: unknown): Promise<void> {
  await writeOut(JSON.stringify(value, null, 2));
}

function die(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function parseStrFlag(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  return undefined;
}

async function showUsage(): Promise<void> {
  await writeOut(`herdr-latm — Local Agent Tool Mesh

Commands:
  list [--json]                         Discover all pane capabilities
  invoke [--pane <id>] --tool <name>    Call a tool (--pane auto-picks shell/reviewer)
                                       [--input '{"query":"foo"}'] [--json]
  sync [--project <path>] [--session NAME] [--json]
                                       Rewrite manifests from live pane list

Examples:
  herdr-latm list
  herdr-latm invoke --tool effect-gates
  herdr-latm invoke --pane wB:p6E --tool diagnose_workspace
  herdr-latm invoke --tool search_code --input '{"query":"TODO"}'
  herdr-latm sync --project .
`);
}

if (isDirectRun(import.meta.path)) {
  const [, cmd, ...args] = Bun.argv;
  const json = parseFlag(args, "--json");

  if (!cmd || cmd === "--help" || cmd === "-h") {
    await showUsage();
    process.exit(0);
  }

  switch (cmd) {
    case "list": {
      const report = await buildLatmListReport();
      if (json) await writeJson(report);
      else await printLatmListHuman(report);
      break;
    }

    case "invoke": {
      const paneFlag = parseStrFlag(args, "--pane");
      const positionalPane = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
      const tool = parseStrFlag(args, "--tool");
      const inputRaw = parseStrFlag(args, "--input");
      const session = parseStrFlag(args, "--session");
      if (!tool) {
        die(
          "Usage: herdr-latm invoke [--pane <id>] --tool <name> [--input <json>] [--session NAME] [--json]"
        );
      }
      let pane = paneFlag ?? positionalPane;
      if (!pane) {
        const report = await buildLatmListReport();
        const picked = pickInvokePane(tool, report.tools);
        if (!picked) die(`No pane exposes tool ${tool}`);
        pane = picked.paneId;
        if (!json) await writeOut(`invoke: auto-routed ${tool} → ${pane} (${picked.role})`);
      }
      const input = inputRaw ? (JSON.parse(inputRaw) as Record<string, unknown>) : {};
      const result = await invokeTool(pane, tool, input, { session });
      if (json) await writeJson(result);
      else await writeJson(result);
      process.exit(result.exitCode);
    }

    case "sync": {
      const projectArg = parseStrFlag(args, "--project") || ".";
      const sessionOverride = parseStrFlag(args, "--session");
      const projectPath = resolveHerdrProjectPath(projectArg);
      const config = discoverHerdrProjectConfig(projectPath);
      if (!config?.enabled) die(`No enabled Herdr project config in ${projectPath}`);
      const resolvedConfig =
        sessionOverride !== undefined ? { ...config, session: sessionOverride } : config;
      const workspaceId = resolveLatmSyncWorkspace(resolvedConfig);
      if (!workspaceId) {
        die(`No Herdr workspace found for ${projectPath}`);
      }
      const synced = await syncLatmManifestsForWorkspace(resolvedConfig, workspaceId);
      if (json) await writeJson({ schemaVersion: 1, workspaceId, ...synced });
      else {
        await writeOut(`LATM sync: ${synced.written.length} manifest(s) written`);
        for (const path of synced.written) await writeOut(`  ${path}`);
        if (synced.pruned.length) {
          await writeOut(`pruned: ${synced.pruned.length} stale manifest dir(s)`);
          for (const path of synced.pruned) await writeOut(`  ${path}`);
        }
        if (synced.skipped.length) await writeOut(`skipped: ${synced.skipped.join(", ")}`);
      }
      break;
    }

    default:
      die(`Unknown command: ${cmd}\n\nRun herdr-latm --help`);
  }
}
