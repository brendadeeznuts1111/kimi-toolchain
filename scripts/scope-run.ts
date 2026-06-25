#!/usr/bin/env bun
/**
 * Run automatable docs/SCOPE.md preflight checks and persist a run log.
 *
 *   bun run scope:run
 *   bun run scope:run --json
 *   bun run scope:run --project ~/kimi-toolchain
 */

import { isAbsolute, join, normalize, resolve } from "path";
import { writeStdoutJsonSync } from "../src/lib/ndjson.ts";
import { ensureDir } from "../src/lib/utils.ts";
import {
  formatScopePreflightReport,
  runScopePreflight,
  type ScopePreflightReport,
} from "../src/lib/scope-preflight.ts";
import { projectKimiDir } from "../src/lib/paths.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function resolveProjectArg(path: string): string {
  return isAbsolute(path) ? normalize(path) : resolve(process.cwd(), path);
}

function parseCli(): { json: boolean; projectRoot: string; writeLog: boolean } {
  const argv = Bun.argv.slice(2);
  let json = false;
  let projectRoot = REPO_ROOT;
  let writeLog = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--no-log") {
      writeLog = false;
      continue;
    }
    if (arg === "--project") {
      const next = argv[++i];
      if (!next) throw new Error("--project requires a path");
      projectRoot = resolveProjectArg(next);
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
  }

  return { json, projectRoot, writeLog };
}

async function persistRunLog(projectRoot: string, report: ScopePreflightReport): Promise<string> {
  const dir = join(projectKimiDir(projectRoot), "var");
  ensureDir(dir);
  const latest = join(dir, "scope-run-latest.json");
  const jsonl = join(dir, "scope-runs.jsonl");
  const line = `${JSON.stringify(report)}\n`;
  await Bun.write(latest, `${JSON.stringify(report, null, 2)}\n`);
  const sink = Bun.file(jsonl).writer();
  sink.write(line);
  await sink.end();
  return latest;
}

async function main(): Promise<number> {
  const { json, projectRoot, writeLog } = parseCli();
  const report = await runScopePreflight(projectRoot);

  if (writeLog) {
    const path = await persistRunLog(projectRoot, report);
    if (!json) {
      console.log(`log: ${path}`);
    } else {
      (report as ScopePreflightReport & { logPath?: string }).logPath = path;
    }
  }

  if (json) {
    writeStdoutJsonSync(report, null);
  } else {
    console.log(formatScopePreflightReport(report));
  }

  return report.ok ? 0 : 1;
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
