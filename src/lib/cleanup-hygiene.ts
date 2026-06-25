/**
 * Unified hygiene cleanup — path scan, repo root, artifacts, or all.
 */

import { join, resolve } from "path"; // @bun-native-exempt:soft-banned-import
import { GENERATED_ARTIFACTS_DIR } from "./artifacts.ts";
import { listDir, pathExists, removePath } from "./bun-io.ts";
import {
  applyPathHygieneCleanup,
  auditPathHygiene,
  defaultPathHygieneRoot,
  PATH_HYGIENE_REPORT_SCHEMA_VERSION,
  type PathHygieneKind,
  type PathHygieneReport,
} from "./path-hygiene.ts";
import { scriptRepoRoot } from "./paths.ts";
import {
  applyRootHygieneCleanup,
  auditRootHygiene,
  fixBunfigCacheMisconfig,
  type RootHygieneReport,
} from "./root-hygiene.ts";
import { resolveEffectiveWorkspaceRoot } from "./workspace-health.ts";

export type HygieneMode = "path" | "root" | "all" | "artifacts";

const VALID_PATH_KINDS: PathHygieneKind[] = ["literal-tilde-dir", "test-bun-artifact"];

export interface HygieneCliOptions {
  mode: HygieneMode;
  dryRun: boolean;
  json: boolean;
  help: boolean;
  fixBunfig: boolean;
  paths: string[];
  maxDepth: number;
  kinds: PathHygieneKind[];
  root?: string;
}

export interface ArtifactsCleanupResult {
  projectRoot: string;
  artifactsDir: string;
  entries: string[];
  removed: number;
}

export type HygieneCleanupOutcome =
  | { type: "help" }
  | {
      type: "path";
      dryRun: boolean;
      json: boolean;
      reports: PathHygieneReport[];
    }
  | {
      type: "root";
      dryRun: boolean;
      json: boolean;
      report: RootHygieneReport;
      bunfigFixed: boolean;
    }
  | {
      type: "artifacts";
      dryRun: boolean;
      json: boolean;
      result: ArtifactsCleanupResult;
    }
  | {
      type: "all";
      dryRun: boolean;
      json: boolean;
      pathReports: PathHygieneReport[];
      rootReport: RootHygieneReport;
      bunfigFixed: boolean;
      artifacts: ArtifactsCleanupResult;
    };

function repoRootFromCwd(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (Bun.env.KIMI_PROJECT_ROOT) return resolve(Bun.env.KIMI_PROJECT_ROOT);
  const { root } = resolveEffectiveWorkspaceRoot(scriptRepoRoot());
  return root;
}

function expandPath(raw: string): string {
  if (raw === "~") return defaultPathHygieneRoot();
  if (raw.startsWith("~/")) return resolve(defaultPathHygieneRoot(), raw.slice(2));
  return resolve(raw);
}

export interface HygieneSummary {
  dirty: boolean;
  itemGroups: number;
  files: number;
  bytes: number;
  misconfigHints: number;
  bunfigFixed: boolean;
}

export function summarizeHygieneOutcome(outcome: HygieneCleanupOutcome): HygieneSummary | null {
  if (outcome.type === "help") return null;

  const base = {
    dirty: false,
    itemGroups: 0,
    files: 0,
    bytes: 0,
    misconfigHints: 0,
    bunfigFixed: false,
  };

  switch (outcome.type) {
    case "path": {
      for (const report of outcome.reports) {
        base.itemGroups += report.items.length;
        base.files += report.totalFiles;
        base.bytes += report.totalBytes;
        base.misconfigHints += report.misconfig.length;
        if (report.repoRootHygiene) {
          base.itemGroups += report.repoRootHygiene.items.length;
          base.files += report.repoRootHygiene.totalFiles;
          base.bytes += report.repoRootHygiene.totalBytes;
          base.misconfigHints += report.repoRootHygiene.misconfig.length;
        }
      }
      break;
    }
    case "root": {
      base.itemGroups = outcome.report.items.length;
      base.files = outcome.report.totalFiles;
      base.bytes = outcome.report.totalBytes;
      base.misconfigHints = outcome.report.misconfig.length;
      base.bunfigFixed = outcome.bunfigFixed;
      break;
    }
    case "artifacts": {
      base.itemGroups = outcome.result.entries.length;
      base.files = outcome.result.entries.length;
      break;
    }
    case "all": {
      for (const report of outcome.pathReports) {
        base.itemGroups += report.items.length;
        base.files += report.totalFiles;
        base.bytes += report.totalBytes;
        base.misconfigHints += report.misconfig.length;
      }
      base.itemGroups += outcome.rootReport.items.length;
      base.files += outcome.rootReport.totalFiles;
      base.bytes += outcome.rootReport.totalBytes;
      base.misconfigHints += outcome.rootReport.misconfig.length;
      base.itemGroups += outcome.artifacts.entries.length;
      base.files += outcome.artifacts.entries.length;
      base.bunfigFixed = outcome.bunfigFixed;
      break;
    }
  }

  base.dirty = base.itemGroups > 0 || base.misconfigHints > 0;
  return base;
}

/** Non-zero when hygiene issues remain or were just cleaned (actionable signal for CI). */
export function hygieneExitCode(outcome: HygieneCleanupOutcome): number {
  if (outcome.type === "help") return 0;
  const summary = summarizeHygieneOutcome(outcome);
  return summary?.dirty ? 1 : 0;
}

export function parseHygieneArgs(argv: string[]): HygieneCliOptions {
  let mode: HygieneMode | undefined;
  let dryRun = false;
  let json = false;
  let help = false;
  let fixBunfig = false;
  const paths: string[] = [];
  let maxDepth = 6;
  let kinds: PathHygieneKind[] = ["literal-tilde-dir", "test-bun-artifact"];
  let root: string | undefined;

  const args = [...argv];
  const first = args[0];
  if (first === "path" || first === "root" || first === "all" || first === "artifacts") {
    mode = first;
    args.shift();
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--dry-run" || arg === "--dryrun") dryRun = true;
    else if (arg === "--json") json = true;
    else if (arg === "--fix-bunfig" || arg === "--fix") fixBunfig = true;
    else if (arg === "--path" || arg === "-p") {
      const next = args[++i];
      if (!next) throw new Error("--path requires a directory");
      paths.push(next);
    } else if (arg.startsWith("--path=")) paths.push(arg.slice("--path=".length));
    else if (arg === "--root") {
      const next = args[++i];
      if (!next) throw new Error("--root requires a directory");
      root = next;
    } else if (arg.startsWith("--root=")) root = arg.slice("--root=".length);
    else if (arg === "--max-depth") {
      const next = args[++i];
      if (!next) throw new Error("--max-depth requires a number");
      maxDepth = Number(next);
      if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new Error("--max-depth must be >= 0");
    } else if (arg.startsWith("--max-depth=")) {
      maxDepth = Number(arg.slice("--max-depth=".length));
      if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new Error("--max-depth must be >= 0");
    } else if (arg === "--kinds") {
      const next = args[++i];
      if (!next) throw new Error("--kinds requires a comma-separated list");
      kinds = next.split(",").map((k) => k.trim()) as PathHygieneKind[];
      for (const k of kinds) {
        if (!VALID_PATH_KINDS.includes(k)) throw new Error(`Unknown kind: ${k}`);
      }
    } else if (arg.startsWith("--kinds=")) {
      kinds = arg
        .slice("--kinds=".length)
        .split(",")
        .map((k) => k.trim()) as PathHygieneKind[];
      for (const k of kinds) {
        if (!VALID_PATH_KINDS.includes(k)) throw new Error(`Unknown kind: ${k}`);
      }
    } else throw new Error(`Unknown option: ${arg}`);
  }

  return {
    mode: mode ?? "path",
    dryRun,
    json,
    help,
    fixBunfig,
    paths,
    maxDepth,
    kinds,
    root,
  };
}

async function runPathHygiene(options: HygieneCliOptions): Promise<PathHygieneReport[]> {
  const targets = options.paths.length > 0 ? options.paths : [defaultPathHygieneRoot()];
  const reports: PathHygieneReport[] = [];
  for (const target of targets) {
    const scanRoot = expandPath(target);
    const report = await auditPathHygiene(scanRoot, {
      dryRun: options.dryRun,
      maxDepth: options.maxDepth,
      kinds: options.kinds,
    });
    if (!options.dryRun) await applyPathHygieneCleanup(report);
    reports.push(report);
  }
  return reports;
}

async function runRootHygiene(
  options: HygieneCliOptions
): Promise<{ report: RootHygieneReport; bunfigFixed: boolean }> {
  const projectRoot = repoRootFromCwd(options.root);
  const bunfigFixed =
    options.fixBunfig && !options.dryRun ? fixBunfigCacheMisconfig(projectRoot) : false;
  const report = await auditRootHygiene(projectRoot, { dryRun: options.dryRun });
  applyRootHygieneCleanup(report);
  return { report, bunfigFixed };
}

function runArtifactsCleanup(options: HygieneCliOptions): ArtifactsCleanupResult {
  const projectRoot = repoRootFromCwd(options.root);
  const artifactsDir = join(projectRoot, GENERATED_ARTIFACTS_DIR);
  if (!pathExists(artifactsDir)) {
    return { projectRoot, artifactsDir, entries: [], removed: 0 };
  }

  const entries = listDir(artifactsDir);
  if (options.dryRun || entries.length === 0) {
    return { projectRoot, artifactsDir, entries, removed: 0 };
  }

  for (const entry of entries) {
    removePath(join(artifactsDir, entry), { recursive: true, force: true });
  }
  return { projectRoot, artifactsDir, entries, removed: entries.length };
}

export async function executeHygieneCleanup(argv: string[]): Promise<HygieneCleanupOutcome> {
  const options = parseHygieneArgs(argv);
  if (options.help) return { type: "help" };

  if (options.mode === "path") {
    return {
      type: "path",
      dryRun: options.dryRun,
      json: options.json,
      reports: await runPathHygiene(options),
    };
  }

  if (options.mode === "root") {
    const { report, bunfigFixed } = await runRootHygiene(options);
    return {
      type: "root",
      dryRun: options.dryRun,
      json: options.json,
      report,
      bunfigFixed,
    };
  }

  if (options.mode === "artifacts") {
    return {
      type: "artifacts",
      dryRun: options.dryRun,
      json: options.json,
      result: runArtifactsCleanup(options),
    };
  }

  const pathReports = await runPathHygiene(options);
  const { report: rootReport, bunfigFixed } = await runRootHygiene(options);
  const artifacts = runArtifactsCleanup(options);
  return {
    type: "all",
    dryRun: options.dryRun,
    json: options.json,
    pathReports,
    rootReport,
    bunfigFixed,
    artifacts,
  };
}

export function hygieneCleanupJsonPayload(
  outcome: Exclude<HygieneCleanupOutcome, { type: "help" }>
): unknown {
  switch (outcome.type) {
    case "path":
      return {
        schemaVersion: PATH_HYGIENE_REPORT_SCHEMA_VERSION,
        tool: "cleanup:path",
        dryRun: outcome.dryRun,
        reports: outcome.reports,
      };
    case "root":
      return {
        schemaVersion: 1,
        tool: "cleanup:root",
        projectRoot: outcome.report.projectRoot,
        dryRun: outcome.report.dryRun,
        count: outcome.report.items.length,
        totalFiles: outcome.report.totalFiles,
        totalBytes: outcome.report.totalBytes,
        bunfigFixed: outcome.bunfigFixed,
        misconfig: outcome.report.misconfig,
        items: outcome.report.items,
      };
    case "artifacts":
      return {
        schemaVersion: 1,
        tool: "cleanup:artifacts",
        dryRun: outcome.dryRun,
        ...outcome.result,
      };
    case "all":
      return {
        schemaVersion: 1,
        tool: "cleanup:all",
        dryRun: outcome.dryRun,
        path: outcome.pathReports,
        root: {
          projectRoot: outcome.rootReport.projectRoot,
          count: outcome.rootReport.items.length,
          totalFiles: outcome.rootReport.totalFiles,
          totalBytes: outcome.rootReport.totalBytes,
          bunfigFixed: outcome.bunfigFixed,
          misconfig: outcome.rootReport.misconfig,
          items: outcome.rootReport.items,
        },
        artifacts: outcome.artifacts,
      };
  }
}
