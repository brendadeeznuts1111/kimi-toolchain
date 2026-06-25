#!/usr/bin/env bun
/**
 * cleanup:path — Scan $HOME or any path for literal `~` dirs and test-bun compile junk.
 *
 * Usage:
 *   bun run cleanup:path
 *   bun run cleanup:path -- --dry-run
 *   bun run cleanup:path -- --path ~/Projects --max-depth 4
 *   kimi-toolchain cleanup path [--dry-run] [--json] [--path <dir>]
 */

import { resolve } from "path";
import {
  applyPathHygieneCleanup,
  auditPathHygiene,
  defaultPathHygieneRoot,
  PATH_HYGIENE_REPORT_SCHEMA_VERSION,
  type PathHygieneKind,
  type PathHygieneReport,
} from "../src/lib/path-hygiene.ts";
import { scrubProcessBunInstallCacheEnv } from "../src/lib/root-hygiene.ts";

scrubProcessBunInstallCacheEnv();

const VALID_KINDS: PathHygieneKind[] = ["literal-tilde-dir", "test-bun-artifact"];

function parseArgs(argv: string[]): {
  dryRun: boolean;
  json: boolean;
  help: boolean;
  paths: string[];
  maxDepth: number;
  kinds: PathHygieneKind[];
} {
  let dryRun = false;
  let json = false;
  let help = false;
  const paths: string[] = [];
  let maxDepth = 6;
  let kinds: PathHygieneKind[] = ["literal-tilde-dir", "test-bun-artifact"];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--dry-run" || arg === "--dryrun") dryRun = true;
    else if (arg === "--json") json = true;
    else if (arg === "--path" || arg === "-p") {
      const next = argv[++i];
      if (!next) throw new Error("--path requires a directory");
      paths.push(next);
    } else if (arg.startsWith("--path=")) paths.push(arg.slice("--path=".length));
    else if (arg === "--max-depth") {
      const next = argv[++i];
      if (!next) throw new Error("--max-depth requires a number");
      maxDepth = Number(next);
      if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new Error("--max-depth must be >= 0");
    } else if (arg.startsWith("--max-depth=")) {
      maxDepth = Number(arg.slice("--max-depth=".length));
      if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new Error("--max-depth must be >= 0");
    } else if (arg === "--kinds") {
      const next = argv[++i];
      if (!next) throw new Error("--kinds requires a comma-separated list");
      kinds = next.split(",").map((k) => k.trim()) as PathHygieneKind[];
      for (const k of kinds) {
        if (!VALID_KINDS.includes(k)) throw new Error(`Unknown kind: ${k}`);
      }
    } else if (arg.startsWith("--kinds=")) {
      kinds = arg
        .slice("--kinds=".length)
        .split(",")
        .map((k) => k.trim()) as PathHygieneKind[];
      for (const k of kinds) {
        if (!VALID_KINDS.includes(k)) throw new Error(`Unknown kind: ${k}`);
      }
    } else throw new Error(`Unknown option: ${arg}`);
  }

  return { dryRun, json, help, paths, maxDepth, kinds };
}

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function expandPath(raw: string): string {
  if (raw === "~") return defaultPathHygieneRoot();
  if (raw.startsWith("~/")) return resolve(defaultPathHygieneRoot(), raw.slice(2));
  return resolve(raw);
}

function renderText(report: PathHygieneReport): void {
  if (report.misconfig.length > 0) {
    console.log("Cache misconfig (fix to prevent recurrence):");
    for (const hint of report.misconfig) console.log(`  • ${hint}`);
    console.log("");
  }

  if (report.items.length === 0) {
    console.log(`Path is clean — no hygiene artifacts under ${report.scanRoot}`);
    return;
  }

  console.log(
    report.dryRun
      ? `Would remove ${report.items.length} item(s), ${report.totalFiles} file(s) (${formatBytes(report.totalBytes)}):`
      : `Removing ${report.items.length} item(s), ${report.totalFiles} file(s) (${formatBytes(report.totalBytes)}):`
  );
  for (const item of report.items) {
    console.log(
      `  ${item.kind.padEnd(20)} ${item.relPath} — ${item.fileCount} file(s), ${formatBytes(item.bytes)}`
    );
    console.log(`    ${item.cause}`);
  }

  if (report.repoRootHygiene && report.repoRootHygiene.items.length > 0) {
    console.log(`\nAlso ${report.repoRootHygiene.items.length} repo-root artifact(s) (see cleanup:root)`);
  }
}

function printHelp(): void {
  console.log(`cleanup:path — scan a directory tree for Bun path pollution

Usage:
  bun run cleanup:path
  bun run cleanup:path:dry-run
  kimi-toolchain cleanup path [--dry-run] [--json] [--path <dir>] [--max-depth N]

Defaults:
  --path $HOME
  --max-depth 6
  --kinds literal-tilde-dir,test-bun-artifact

Skips: node_modules, .git, Library, SecureArchives, and other heavy system trees.

Targets:
  literal-tilde-dir   Directory named "~" (Bun cache misconfig)
  test-bun-artifact   test-bun* compile probe output directories`);
}

async function runForPath(
  rawPath: string,
  options: { dryRun: boolean; maxDepth: number; kinds: PathHygieneKind[] }
): Promise<PathHygieneReport> {
  const scanRoot = expandPath(rawPath);
  const report = await auditPathHygiene(scanRoot, {
    dryRun: options.dryRun,
    maxDepth: options.maxDepth,
    kinds: options.kinds,
  });
  if (!options.dryRun) {
    await applyPathHygieneCleanup(report);
  }
  return report;
}

async function main(): Promise<number> {
  const { dryRun, json, help, paths, maxDepth, kinds } = parseArgs(Bun.argv.slice(2));
  if (help) {
    printHelp();
    return 0;
  }

  const targets = paths.length > 0 ? paths : [defaultPathHygieneRoot()];
  const reports: PathHygieneReport[] = [];
  for (const target of targets) {
    reports.push(await runForPath(target, { dryRun, maxDepth, kinds }));
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: PATH_HYGIENE_REPORT_SCHEMA_VERSION,
          tool: "cleanup:path",
          dryRun,
          reports,
        },
        null,
        2
      )
    );
  } else {
    for (const report of reports) {
      if (reports.length > 1) console.log(`\n── ${report.scanRoot} ──`);
      renderText(report);
    }
  }

  return 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});