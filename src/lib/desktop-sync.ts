/**
 * Canonical repo → ~/.kimi-code/ sync (single source of truth).
 */

import { existsSync } from "fs";
import { dirname, join } from "path";
import { ensureDir } from "./utils.ts";

export function desktopRoot(): string {
  return join(Bun.env.HOME || "/tmp", ".kimi-code");
}
export const AGENTS_SKILLS_ROOT = join(Bun.env.HOME || "/tmp", ".agents", "skills");

export function kimiCodeSkillsRoot(): string {
  return join(desktopRoot(), "skills");
}

export const ROOT_TEMPLATES = [
  "AGENTS.md",
  "UNIFIED.md",
  "TEMPLATES.md",
  "CONTRIBUTING.md",
  "dx.config.toml",
  "kimi-toolchain.code-workspace",
  "error-taxonomy.yml",
] as const;

export const OPTIONAL_CONFIG_FILES = ["bunfig.toml", ".gitignore"] as const;

export const TOOL_ORPHANS = ["kimi-utils.ts"] as const;

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
  skillSrc: string;
  skillDst: string;
  kimiSkillDst: string;
}

export function resolveDesktopPaths(repoRoot: string): DesktopPaths {
  return {
    repoRoot,
    desktopRoot: desktopRoot(),
    binSrc: join(repoRoot, "src", "bin"),
    binDst: join(desktopRoot(), "tools"),
    libSrc: join(repoRoot, "src", "lib"),
    libDst: join(desktopRoot(), "lib"),
    scriptsSrc: join(repoRoot, "scripts"),
    scriptsDst: join(desktopRoot(), "scripts"),
    kimiHooksSrc: join(repoRoot, "src", "kimi-hooks"),
    kimiHooksDst: join(desktopRoot(), "kimi-hooks"),
    skillSrc: join(repoRoot, "skills", "kimi-toolchain"),
    skillDst: join(AGENTS_SKILLS_ROOT, "kimi-toolchain"),
    kimiSkillDst: join(kimiCodeSkillsRoot(), "kimi-toolchain"),
  };
}

export function ensureDesktopLayout(): void {
  for (const dir of [
    join(desktopRoot(), "tools"),
    join(desktopRoot(), "lib"),
    join(desktopRoot(), "scripts"),
    join(desktopRoot(), "kimi-hooks"),
    join(desktopRoot(), "var"),
    join(desktopRoot(), "memory"),
    join(desktopRoot(), "guardian"),
    join(desktopRoot(), "governor"),
    kimiCodeSkillsRoot(),
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
    return null;
  }
}

async function copyIfChanged(
  srcPath: string,
  dstPath: string,
  label: string,
  force: boolean,
  result: SyncFileResult
): Promise<void> {
  const srcText = await readTextOrNull(srcPath);
  if (srcText === null) return;

  const dstText = await readTextOrNull(dstPath);
  if (force || srcText !== dstText) {
    ensureDir(dirname(dstPath));
    await Bun.write(dstPath, srcText);
    result.updated.push(label);
  } else {
    result.skipped++;
  }
}

/** Sync managed sources from repo to desktop install. */
export async function syncDesktop(
  repoRoot: string,
  options: { force?: boolean } = {}
): Promise<SyncFileResult> {
  const force = options.force ?? false;
  const paths = resolveDesktopPaths(repoRoot);
  const result: SyncFileResult = { updated: [], removed: [], skipped: 0 };

  ensureDesktopLayout();

  const binGlob = new Bun.Glob("*.ts");
  for await (const file of binGlob.scan(paths.binSrc)) {
    await copyIfChanged(
      join(paths.binSrc, file),
      join(paths.binDst, file),
      `tools/${file}`,
      force,
      result
    );
  }

  const libGlob = new Bun.Glob("*.ts");
  for await (const file of libGlob.scan(paths.libSrc)) {
    await copyIfChanged(
      join(paths.libSrc, file),
      join(paths.libDst, file),
      `lib/${file}`,
      force,
      result
    );
  }

  if (existsSync(paths.scriptsSrc)) {
    const scriptsGlob = new Bun.Glob("*.ts");
    for await (const file of scriptsGlob.scan(paths.scriptsSrc)) {
      await copyIfChanged(
        join(paths.scriptsSrc, file),
        join(paths.scriptsDst, file),
        `scripts/${file}`,
        force,
        result
      );
    }
  }

  if (existsSync(paths.kimiHooksSrc)) {
    const kimiHooksGlob = new Bun.Glob("*.ts");
    for await (const file of kimiHooksGlob.scan(paths.kimiHooksSrc)) {
      await copyIfChanged(
        join(paths.kimiHooksSrc, file),
        join(paths.kimiHooksDst, file),
        `kimi-hooks/${file}`,
        force,
        result
      );
    }
  }

  for (const doc of ROOT_TEMPLATES) {
    await copyIfChanged(join(repoRoot, doc), join(desktopRoot(), doc), doc, force, result);
  }

  if (!force) {
    for (const file of OPTIONAL_CONFIG_FILES) {
      const srcPath = join(repoRoot, file);
      const dstPath = join(desktopRoot(), file);
      if (!existsSync(dstPath) && existsSync(srcPath)) {
        await Bun.write(dstPath, await Bun.file(srcPath).text());
        result.updated.push(file);
      }
    }
  } else {
    for (const file of OPTIONAL_CONFIG_FILES) {
      await copyIfChanged(join(repoRoot, file), join(desktopRoot(), file), file, true, result);
    }
  }

  if (existsSync(paths.skillSrc)) {
    const skillGlob = new Bun.Glob("**/*");
    for await (const rel of skillGlob.scan({ cwd: paths.skillSrc, onlyFiles: true })) {
      await copyIfChanged(
        join(paths.skillSrc, rel),
        join(paths.skillDst, rel),
        `agents-skill/${rel}`,
        force,
        result
      );
      await copyIfChanged(
        join(paths.skillSrc, rel),
        join(paths.kimiSkillDst, rel),
        `kimi-skill/${rel}`,
        force,
        result
      );
    }
  }

  for (const orphan of TOOL_ORPHANS) {
    const orphanPath = join(paths.binDst, orphan);
    if ((await readTextOrNull(orphanPath)) !== null) {
      await Bun.$`rm -f ${orphanPath}`.nothrow().quiet();
      result.removed.push(`tools/${orphan}`);
    }
  }

  return result;
}
