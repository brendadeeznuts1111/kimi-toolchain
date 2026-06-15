/**
 * Canonical repo → ~/.kimi-code/ sync (single source of truth).
 */

import { existsSync } from "fs";
import { dirname, join } from "path";
import { ensureDir } from "./utils.ts";
import {
  desktopRoot as _desktopRoot,
  agentsSkillsRoot,
  toolsDir,
  libDir,
  scriptsDir,
  kimiHooksDir,
  varDir,
  memoryDir,
  guardianDir,
  governorDir,
  skillsDir,
} from "./paths.ts";

export const desktopRoot = _desktopRoot;
export const AGENTS_SKILLS_ROOT = agentsSkillsRoot();

/** @deprecated Use skillsDir() from paths.ts instead. */
export function kimiCodeSkillsRoot(): string {
  return skillsDir();
}

export const ROOT_TEMPLATES = [
  "AGENTS.md",
  "CODE_REFERENCES.md",
  "UNIFIED.md",
  "TEMPLATES.md",
  "CONTRIBUTING.md",
  "dx.config.toml",
  "kimi-toolchain.code-workspace",
  "error-taxonomy.yml",
] as const;

export const OPTIONAL_CONFIG_FILES = ["bunfig.toml", ".gitignore"] as const;

export const TOOL_ORPHANS = ["kimi-utils.ts"] as const;

export const LABEL_PREFIX = {
  TOOLS: "tools/",
  LIB: "lib/",
  SCRIPTS: "scripts/",
  KIMI_HOOKS: "kimi-hooks/",
  TEMPLATES: "templates/",
  AGENTS_SKILL: "agents-skill/",
  KIMI_SKILL: "kimi-skill/",
} as const;

export interface DesktopPaths {
  repoRoot: string;
  desktopRoot: string;
  binSrc: string;
  binDst: string;
  libSrc: string;
  libDst: string;
  scriptsSrc: string;
  scriptsDst: string;
  kimiHooksSrc: string;
  kimiHooksDst: string;
  templatesSrc: string;
  templatesDst: string;
  skillSrc: string;
  skillDst: string;
  kimiSkillDst: string;
}

export function resolveDesktopPaths(repoRoot: string): DesktopPaths {
  const dRoot = desktopRoot();
  return {
    repoRoot,
    desktopRoot: dRoot,
    binSrc: join(repoRoot, "src", "bin"),
    binDst: toolsDir(),
    libSrc: join(repoRoot, "src", "lib"),
    libDst: libDir(),
    scriptsSrc: join(repoRoot, "scripts"),
    scriptsDst: scriptsDir(),
    kimiHooksSrc: join(repoRoot, "src", "kimi-hooks"),
    kimiHooksDst: kimiHooksDir(),
    templatesSrc: join(repoRoot, "templates"),
    templatesDst: join(dRoot, "templates"),
    skillSrc: join(repoRoot, "skills", "kimi-toolchain"),
    skillDst: join(AGENTS_SKILLS_ROOT, "kimi-toolchain"),
    kimiSkillDst: join(skillsDir(), "kimi-toolchain"),
  };
}

export function ensureDesktopLayout(): void {
  for (const dir of [
    toolsDir(),
    libDir(),
    scriptsDir(),
    kimiHooksDir(),
    varDir(),
    memoryDir(),
    guardianDir(),
    governorDir(),
    skillsDir(),
  ]) {
    ensureDir(dir);
  }
}

export interface SyncFileResult {
  updated: string[];
  removed: string[];
  skipped: number;
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    // File not found or unreadable — expected when destination does not exist yet.
    // Permission errors are intentionally treated as "missing" for sync idempotency.
    return null;
  }
}

async function copyIfChanged(
  srcPath: string,
  dstPath: string,
  label: string,
  force: boolean,
  dryRun: boolean,
  result: SyncFileResult
): Promise<void> {
  const srcText = await readTextOrNull(srcPath);
  if (srcText === null) return;

  const dstText = await readTextOrNull(dstPath);
  if (force || srcText !== dstText) {
    if (!dryRun) {
      ensureDir(dirname(dstPath));
      await Bun.write(dstPath, srcText);
    }
    result.updated.push(label);
  } else {
    result.skipped++;
  }
}

async function syncGlobDirectory(
  srcDir: string,
  dstDir: string,
  labelPrefix: string,
  globPattern: string,
  force: boolean,
  dryRun: boolean,
  result: SyncFileResult
): Promise<void> {
  const glob = new Bun.Glob(globPattern);
  for await (const file of glob.scan(srcDir)) {
    await copyIfChanged(
      join(srcDir, file),
      join(dstDir, file),
      `${labelPrefix}${file}`,
      force,
      dryRun,
      result
    );
  }
}

/** Sync managed sources from repo to desktop install. */
export async function syncDesktop(
  repoRoot: string,
  options: { force?: boolean; dryRun?: boolean } = {}
): Promise<SyncFileResult> {
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;
  const paths = resolveDesktopPaths(repoRoot);
  const result: SyncFileResult = { updated: [], removed: [], skipped: 0 };

  if (!dryRun) ensureDesktopLayout();

  await syncGlobDirectory(
    paths.binSrc,
    paths.binDst,
    LABEL_PREFIX.TOOLS,
    "*.ts",
    force,
    dryRun,
    result
  );
  await syncGlobDirectory(
    paths.libSrc,
    paths.libDst,
    LABEL_PREFIX.LIB,
    "**/*.ts",
    force,
    dryRun,
    result
  );

  if (existsSync(paths.scriptsSrc)) {
    await syncGlobDirectory(
      paths.scriptsSrc,
      paths.scriptsDst,
      LABEL_PREFIX.SCRIPTS,
      "*.ts",
      force,
      dryRun,
      result
    );
  }

  if (existsSync(paths.kimiHooksSrc)) {
    await syncGlobDirectory(
      paths.kimiHooksSrc,
      paths.kimiHooksDst,
      LABEL_PREFIX.KIMI_HOOKS,
      "*.ts",
      force,
      dryRun,
      result
    );
  }

  if (existsSync(paths.templatesSrc)) {
    await syncGlobDirectory(
      paths.templatesSrc,
      paths.templatesDst,
      LABEL_PREFIX.TEMPLATES,
      "**/*",
      force,
      dryRun,
      result
    );
  }

  for (const doc of ROOT_TEMPLATES) {
    await copyIfChanged(join(repoRoot, doc), join(desktopRoot(), doc), doc, force, dryRun, result);
  }

  for (const file of OPTIONAL_CONFIG_FILES) {
    const srcPath = join(repoRoot, file);
    const dstPath = join(desktopRoot(), file);
    if (force) {
      await copyIfChanged(srcPath, dstPath, file, true, dryRun, result);
    } else if (!existsSync(dstPath) && existsSync(srcPath)) {
      if (!dryRun) await Bun.write(dstPath, await Bun.file(srcPath).text());
      result.updated.push(file);
    }
  }

  if (existsSync(paths.skillSrc)) {
    const skillGlob = new Bun.Glob("**/*");
    for await (const rel of skillGlob.scan({ cwd: paths.skillSrc, onlyFiles: true })) {
      await copyIfChanged(
        join(paths.skillSrc, rel),
        join(paths.skillDst, rel),
        `${LABEL_PREFIX.AGENTS_SKILL}${rel}`,
        force,
        dryRun,
        result
      );
      await copyIfChanged(
        join(paths.skillSrc, rel),
        join(paths.kimiSkillDst, rel),
        `${LABEL_PREFIX.KIMI_SKILL}${rel}`,
        force,
        dryRun,
        result
      );
    }
  }

  for (const orphan of TOOL_ORPHANS) {
    const orphanPath = join(paths.binDst, orphan);
    if ((await readTextOrNull(orphanPath)) !== null) {
      if (!dryRun) {
        try {
          await Bun.file(orphanPath).delete();
        } catch {
          // Ignore deletion failures (e.g., permission denied).
        }
      }
      result.removed.push(`${LABEL_PREFIX.TOOLS}${orphan}`);
    }
  }

  return result;
}
