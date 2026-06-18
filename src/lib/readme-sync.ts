/**
 * README ↔ package.json script drift detection and auto-patch.
 */

import { join } from "path";
import { safeParse } from "./utils.ts";

// ── Constants ──────────────────────────────────────────────────────────

const README_FILE = "README.md";
const PACKAGE_FILE = "package.json";

const EXIT_OK = 0;
const EXIT_DRIFT = 1;
const EXIT_ERROR = 1;

const SCRIPT_PATTERN = /(?:bun run |npm run |yarn )([\w:-]+)/g;
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const NEXT_SECTION_PATTERN = /\n### /;

const TABLE_ROW_TEMPLATE = (script: string) =>
  `| \`bun run ${script}\` | (synced from package.json) |`;

/** Lifecycle/internal scripts — omitted from README drift checks. */
export const README_SCRIPT_EXCLUSIONS = new Set(["postinstall", "toolchain"]);

export const README_SCRIPT_SYNC_START = "<!-- package-scripts-sync -->";
export const README_SCRIPT_SYNC_END = "<!-- /package-scripts-sync -->";
const README_SCRIPT_SYNC_BLOCK_RE =
  /<!-- package-scripts-sync -->[\s\S]*?<!-- \/package-scripts-sync -->/;

// ── Types ──────────────────────────────────────────────────────────────

export interface DocDrift {
  readmeScripts: string[];
  pkgScripts: string[];
  missingFromReadme: string[];
  extraInReadme: string[];
  fresh: boolean;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

function isPackageJson(val: unknown): val is PackageJson {
  return (
    typeof val === "object" &&
    val !== null &&
    ("scripts" in val === false || typeof (val as PackageJson).scripts === "object")
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function readmePath(projectDir: string): string {
  return join(projectDir, README_FILE);
}

function packagePath(projectDir: string): string {
  return join(projectDir, PACKAGE_FILE);
}

function extractReadmeScripts(readme: string, pkgScripts: Record<string, string>): string[] {
  const found: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = SCRIPT_PATTERN.exec(readme)) !== null) {
    found.push(match[1]);
  }

  const codeBlocks = readme.match(CODE_BLOCK_PATTERN) || [];
  for (const block of codeBlocks) {
    for (const scriptName of Object.keys(pkgScripts)) {
      if (block.includes(scriptName) && !found.includes(scriptName)) {
        found.push(scriptName);
      }
    }
  }

  return found;
}

function trackedPackageScripts(pkgScripts: Record<string, string>): string[] {
  return Object.keys(pkgScripts).filter((name) => !README_SCRIPT_EXCLUSIONS.has(name));
}

function computeDrift(readmeScripts: string[], pkgScripts: Record<string, string>): DocDrift {
  const pkgScriptNames = trackedPackageScripts(pkgScripts);
  const missingFromReadme = pkgScriptNames.filter((s) => !readmeScripts.includes(s));
  const extraInReadme = readmeScripts.filter(
    (s) => !pkgScriptNames.includes(s) && !README_SCRIPT_EXCLUSIONS.has(s)
  );

  return {
    readmeScripts,
    pkgScripts: pkgScriptNames,
    missingFromReadme,
    extraInReadme,
    fresh: missingFromReadme.length === 0 && extraInReadme.length === 0,
  };
}

// ── Pure computation ───────────────────────────────────────────────────

export async function checkDocDrift(projectDir: string): Promise<DocDrift | null> {
  const drift: DocDrift = {
    readmeScripts: [],
    pkgScripts: [],
    missingFromReadme: [],
    extraInReadme: [],
    fresh: true,
  };

  const readmeFile = Bun.file(readmePath(projectDir));
  const pkgFile = Bun.file(packagePath(projectDir));

  if (!(await readmeFile.exists()) || !(await pkgFile.exists())) {
    drift.fresh = false;
    return drift;
  }

  const readme = await readmeFile.text();
  const pkgText = await pkgFile.text();
  const pkgRaw = safeParse(pkgText, null, isPackageJson);

  if (pkgRaw === null) {
    return null;
  }

  const scripts = pkgRaw.scripts || {};
  const readmeScripts = extractReadmeScripts(readme, scripts);

  return computeDrift(readmeScripts, scripts);
}

// ── Side-effect operations ─────────────────────────────────────────────

/** Build the patch rows for missing scripts (pure). */
export function buildPatchRows(missingScripts: string[]): string {
  return missingScripts.map(TABLE_ROW_TEMPLATE).join("\n");
}

/** Single markdown table block for auto-synced package.json scripts. */
export function buildScriptSyncBlock(pkgScripts: Record<string, string>): string {
  const rows = trackedPackageScripts(pkgScripts).sort().map(TABLE_ROW_TEMPLATE).join("\n");
  return [
    README_SCRIPT_SYNC_START,
    "| Script | Description |",
    "| --- | --- |",
    rows,
    README_SCRIPT_SYNC_END,
  ].join("\n");
}

/** Append missing package.json scripts to the README Project Scripts table.
 *  Returns the number of scripts patched, or -1 on error.
 */
export async function patchReadmeScripts(projectDir: string): Promise<number> {
  const drift = await checkDocDrift(projectDir);
  if (drift === null) return -1;
  if (drift.missingFromReadme.length === 0) return 0;

  const path = readmePath(projectDir);
  let readme = await Bun.file(path).text();
  const pkgText = await Bun.file(packagePath(projectDir)).text();
  const pkgRaw = safeParse(pkgText, null, isPackageJson);
  if (pkgRaw === null) return -1;
  const scripts = pkgRaw.scripts || {};

  if (README_SCRIPT_SYNC_BLOCK_RE.test(readme)) {
    readme = readme.replace(README_SCRIPT_SYNC_BLOCK_RE, buildScriptSyncBlock(scripts));
  } else {
    const block = `### Auto-synced scripts\n\n${buildScriptSyncBlock(scripts)}\n\n`;
    const sectionEnd = readme.search(NEXT_SECTION_PATTERN);
    if (sectionEnd > 0) {
      readme = readme.slice(0, sectionEnd) + "\n\n" + block + readme.slice(sectionEnd);
    } else {
      readme += "\n\n" + block;
    }
  }

  await Bun.write(path, readme);
  return drift.missingFromReadme.length;
}

// ── CLI entry ──────────────────────────────────────────────────────────

export interface ReadmeSyncResult {
  exitCode: number;
  message: string;
  patched?: number;
}

/** CLI entry — returns structured result instead of logging directly. */
export async function runReadmeSyncCli(args: string[]): Promise<ReadmeSyncResult> {
  try {
    const fix = args.includes("--fix");
    const projectDir = args.find((a) => !a.startsWith("-")) || Bun.cwd;

    if (fix) {
      const patched = await patchReadmeScripts(projectDir);
      if (patched === -1) {
        return { exitCode: EXIT_ERROR, message: "Error: invalid package.json" };
      }
      if (patched > 0) {
        return {
          exitCode: EXIT_OK,
          message: `Patched README.md with ${patched} script(s)`,
          patched,
        };
      }
      return { exitCode: EXIT_OK, message: "README scripts already in sync" };
    }

    const drift = await checkDocDrift(projectDir);
    if (drift === null) {
      return { exitCode: EXIT_ERROR, message: "Error: invalid package.json" };
    }
    if (drift.fresh) {
      return { exitCode: EXIT_OK, message: "README scripts: in sync" };
    }

    const parts: string[] = [];
    if (drift.missingFromReadme.length > 0) {
      parts.push(`Missing from README: ${drift.missingFromReadme.join(", ")}`);
    }
    if (drift.extraInReadme.length > 0) {
      parts.push(`Extra in README: ${drift.extraInReadme.join(", ")}`);
    }
    return { exitCode: EXIT_DRIFT, message: parts.join("; ") };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: EXIT_ERROR, message: `Error: ${message}` };
  }
}
