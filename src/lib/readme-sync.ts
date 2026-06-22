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

const SYNC_BEGIN = "<!-- readme-sync:begin -->";
const SYNC_END = "<!-- readme-sync:end -->";

/** Short human label for auto-patched README script rows. */
export function describeScript(name: string, cmd: string): string {
  const bin = cmd.match(/src\/bin\/([\w-]+)\.ts/);
  if (bin) return `Run ${bin[1]} from repo`;
  if (name === "postinstall") return "Install hook — sets up ~/.kimi-code/";
  if (name.startsWith("test:")) return "Test tier script";
  if (name.startsWith("check:")) return "Quality gate";
  if (name.startsWith("lint:")) return "Lint script";
  if (name.startsWith("audit:") || name === "audit") return "Audit script";
  if (name.startsWith("doctor:") || name.startsWith("deep-audit"))
    return "Doctor / deep-audit script";
  if (name.startsWith("build:portal")) return "Artifact Portal publish script";
  if (name.startsWith("references:")) return "Canonical references script";
  if (name.startsWith("sync")) return "Runtime sync script";
  if (name.startsWith("pm:")) return "Bun package manager helper";
  if (name.startsWith("cleanup")) return "Workspace / artifact cleanup";
  if (cmd.includes("scripts/")) {
    const script = cmd.match(/scripts\/([\w-]+)/);
    if (script) return `scripts/${script[1]}.ts`;
  }
  return "See package.json scripts";
}

const TABLE_ROW_TEMPLATE = (script: string, description: string) =>
  `| \`bun run ${script}\` | ${description} |`;

function buildScriptInventoryTable(scripts: Record<string, string>): string {
  const rows = Object.keys(scripts)
    .sort()
    .map((name) => TABLE_ROW_TEMPLATE(name, describeScript(name, scripts[name] ?? "")));
  return [
    SYNC_BEGIN,
    "",
    "| Command | Description |",
    "| ------- | ----------- |",
    ...rows,
    "",
    SYNC_END,
  ].join("\n");
}

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

function computeDrift(readmeScripts: string[], pkgScripts: Record<string, string>): DocDrift {
  const pkgScriptNames = Object.keys(pkgScripts);
  const missingFromReadme = pkgScriptNames.filter((s) => !readmeScripts.includes(s));
  const extraInReadme = readmeScripts.filter((s) => !pkgScriptNames.includes(s));

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
export function buildPatchRows(
  missingScripts: string[],
  scripts: Record<string, string> = {}
): string {
  return missingScripts
    .map((name) => TABLE_ROW_TEMPLATE(name, describeScript(name, scripts[name] ?? "")))
    .join("\n");
}

function replaceSyncBlock(readme: string, table: string): string {
  const begin = readme.indexOf(SYNC_BEGIN);
  const end = readme.indexOf(SYNC_END);
  if (begin >= 0 && end > begin) {
    return readme.slice(0, begin) + table + readme.slice(end + SYNC_END.length);
  }
  const sectionEnd = readme.search(NEXT_SECTION_PATTERN);
  if (sectionEnd > 0) {
    return readme.slice(0, sectionEnd) + "\n\n" + table + "\n" + readme.slice(sectionEnd);
  }
  return `${readme.trimEnd()}\n\n${table}\n`;
}

/** Rewrite the auto-sync script inventory block from package.json scripts. */
export async function rewriteReadmeScriptInventory(projectDir: string): Promise<number> {
  const pkgRaw = safeParse(await Bun.file(packagePath(projectDir)).text(), null, isPackageJson);
  if (pkgRaw === null) return -1;

  const scripts = pkgRaw.scripts || {};
  const path = readmePath(projectDir);
  const readme = await Bun.file(path).text();
  const table = buildScriptInventoryTable(scripts);
  if (readme.includes(SYNC_BEGIN) && readme.includes(table)) return 0;
  const next = replaceSyncBlock(readme, table);
  await Bun.write(path, next);
  return Object.keys(scripts).length;
}

/** Append missing package.json scripts to the README Project Scripts table.
 *  Returns the number of scripts patched, or -1 on error.
 */
export async function patchReadmeScripts(projectDir: string): Promise<number> {
  const pkgRaw = safeParse(await Bun.file(packagePath(projectDir)).text(), null, isPackageJson);
  if (pkgRaw === null) return -1;

  const readmePath_ = readmePath(projectDir);
  const readme = await Bun.file(readmePath_).text();
  if (readme.includes(SYNC_BEGIN)) {
    return rewriteReadmeScriptInventory(projectDir);
  }

  const drift = await checkDocDrift(projectDir);
  if (drift === null) return -1;
  if (drift.missingFromReadme.length === 0) return 0;

  const scripts = pkgRaw.scripts || {};
  let next = readme;
  const rows = buildPatchRows(drift.missingFromReadme, scripts);

  const sectionEnd = next.search(NEXT_SECTION_PATTERN);
  if (sectionEnd > 0) {
    next = next.slice(0, sectionEnd) + "\n" + rows + next.slice(sectionEnd);
  } else {
    next += "\n" + rows + "\n";
  }

  await Bun.write(readmePath_, next);
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
    const message = err instanceof Error ? err.message : Bun.inspect(err);
    return { exitCode: EXIT_ERROR, message: `Error: ${message}` };
  }
}
