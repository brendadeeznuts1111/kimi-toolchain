/**
 * Canonical repo → ~/.kimi-code/ sync (single source of truth).
 */

import { pathExists } from "./bun-io.ts";
import { collectLocalDocSyncEntries, collectLocalDocSyncPaths } from "./canonical-references.ts";
import { dirname, join } from "path";
import { ensureDir } from "./utils.ts";
import {
  desktopRoot as _desktopRoot,
  agentsSkillsRoot,
  toolsDir,
  libDir,
  canvasesDir,
  gatesDir,
  harnessDir,
  scriptsDir,
  kimiHooksDir,
  varDir,
  memoryDir,
  guardianDir,
  governorDir,
  skillsDir,
  canonicalRepoRoot,
} from "./paths.ts";
import { LABEL_PREFIX, SYNC_ROOT_INFRA } from "./sync-paths.ts";

export { LABEL_PREFIX, SYNC_ROOT_INFRA } from "./sync-paths.ts";

export const desktopRoot = _desktopRoot;

/** All manifest-indexed files + infra extras copied as static paths under ~/.kimi-code/. */
export function collectStaticFileSyncPaths(): readonly string[] {
  return [...collectLocalDocSyncPaths(), ...SYNC_ROOT_INFRA].sort();
}

export const OPTIONAL_CONFIG_FILES = ["bunfig.toml", ".gitignore"] as const;

export const TOOL_ORPHANS = ["kimi-utils.ts"] as const;

export interface DesktopPaths {
  repoRoot: string;
  desktopRoot: string;
  binSrc: string;
  binDst: string;
  libSrc: string;
  libDst: string;
  canvasesSrc: string;
  canvasesDst: string;
  gatesSrc: string;
  gatesDst: string;
  harnessSrc: string;
  harnessDst: string;
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
  repoRoot = canonicalRepoRoot(repoRoot);
  const dRoot = desktopRoot();
  return {
    repoRoot,
    desktopRoot: dRoot,
    binSrc: join(repoRoot, "src", "bin"),
    binDst: toolsDir(),
    libSrc: join(repoRoot, "src", "lib"),
    libDst: libDir(),
    canvasesSrc: join(repoRoot, "src", "canvases"),
    canvasesDst: canvasesDir(),
    gatesSrc: join(repoRoot, "src", "gates"),
    gatesDst: gatesDir(),
    harnessSrc: join(repoRoot, "src", "harness"),
    harnessDst: harnessDir(),
    scriptsSrc: join(repoRoot, "scripts"),
    scriptsDst: scriptsDir(),
    kimiHooksSrc: join(repoRoot, "src", "kimi-hooks"),
    kimiHooksDst: kimiHooksDir(),
    templatesSrc: join(repoRoot, "templates"),
    templatesDst: join(dRoot, "templates"),
    skillSrc: join(repoRoot, "skills", "kimi-toolchain"),
    skillDst: join(agentsSkillsRoot(), "kimi-toolchain"),
    kimiSkillDst: join(skillsDir(), "kimi-toolchain"),
  };
}

export function ensureDesktopLayout(): void {
  for (const dir of [
    toolsDir(),
    libDir(),
    canvasesDir(),
    gatesDir(),
    harnessDir(),
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

async function copyIfChanged(
  srcPath: string,
  dstPath: string,
  label: string,
  force: boolean,
  result: SyncFileResult
): Promise<void> {
  const srcText = await Bun.file(srcPath)
    .text()
    .catch(() => null);
  if (srcText === null) return;

  const dstText = await Bun.file(dstPath)
    .text()
    .catch(() => null);
  if (force || srcText !== dstText) {
    ensureDir(dirname(dstPath));
    await Bun.write(dstPath, srcText);
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
  result: SyncFileResult
): Promise<void> {
  const glob = new Bun.Glob(globPattern);
  for await (const file of glob.scan({ cwd: srcDir, onlyFiles: true })) {
    await copyIfChanged(
      join(srcDir, file),
      join(dstDir, file),
      `${labelPrefix}${file}`,
      force,
      result
    );
  }
}

/** Sync managed sources from repo to desktop install. */
export async function syncDesktop(
  repoRoot: string,
  options: { force?: boolean } = {}
): Promise<SyncFileResult> {
  repoRoot = canonicalRepoRoot(repoRoot);
  const force = options.force ?? false;
  const paths = resolveDesktopPaths(repoRoot);
  const result: SyncFileResult = { updated: [], removed: [], skipped: 0 };

  ensureDesktopLayout();

  await syncGlobDirectory(paths.binSrc, paths.binDst, LABEL_PREFIX.TOOLS, "*.ts", force, result);
  await syncGlobDirectory(paths.libSrc, paths.libDst, LABEL_PREFIX.LIB, "**/*.ts", force, result);
  // JSON sidecars imported by synced lib modules (e.g. bun-upstream-cli-manifest.json).
  await syncGlobDirectory(paths.libSrc, paths.libDst, LABEL_PREFIX.LIB, "**/*.json", force, result);

  if (pathExists(paths.canvasesSrc)) {
    await syncGlobDirectory(
      paths.canvasesSrc,
      paths.canvasesDst,
      LABEL_PREFIX.CANVASES,
      "*.ts",
      force,
      result
    );
  }

  if (pathExists(paths.gatesSrc)) {
    await syncGlobDirectory(
      paths.gatesSrc,
      paths.gatesDst,
      LABEL_PREFIX.GATES,
      "**/*.ts",
      force,
      result
    );
  }

  if (pathExists(paths.harnessSrc)) {
    await syncGlobDirectory(
      paths.harnessSrc,
      paths.harnessDst,
      LABEL_PREFIX.HARNESS,
      "**/*.ts",
      force,
      result
    );
  }

  if (pathExists(paths.scriptsSrc)) {
    await syncGlobDirectory(
      paths.scriptsSrc,
      paths.scriptsDst,
      LABEL_PREFIX.SCRIPTS,
      "*.ts",
      force,
      result
    );
  }

  if (pathExists(paths.kimiHooksSrc)) {
    await syncGlobDirectory(
      paths.kimiHooksSrc,
      paths.kimiHooksDst,
      LABEL_PREFIX.KIMI_HOOKS,
      "*.ts",
      force,
      result
    );
  }

  if (pathExists(paths.templatesSrc)) {
    await syncGlobDirectory(
      paths.templatesSrc,
      paths.templatesDst,
      LABEL_PREFIX.TEMPLATES,
      "**/*",
      force,
      result
    );
  }

  for (const doc of collectLocalDocSyncEntries()) {
    await copyIfChanged(
      join(repoRoot, doc.repoPath),
      join(desktopRoot(), doc.repoPath),
      doc.repoPath,
      force,
      result
    );
  }

  for (const file of SYNC_ROOT_INFRA) {
    await copyIfChanged(join(repoRoot, file), join(desktopRoot(), file), file, force, result);
  }

  for (const file of OPTIONAL_CONFIG_FILES) {
    const srcPath = join(repoRoot, file);
    const dstPath = join(desktopRoot(), file);
    if (force) {
      await copyIfChanged(srcPath, dstPath, file, true, result);
    } else if (!pathExists(dstPath) && pathExists(srcPath)) {
      await Bun.write(dstPath, await Bun.file(srcPath).text());
      result.updated.push(file);
    }
  }

  if (pathExists(paths.skillSrc)) {
    const skillGlob = new Bun.Glob("**/*");
    for await (const rel of skillGlob.scan({ cwd: paths.skillSrc, onlyFiles: true })) {
      await copyIfChanged(
        join(paths.skillSrc, rel),
        join(paths.skillDst, rel),
        `${LABEL_PREFIX.AGENTS_SKILL}${rel}`,
        force,
        result
      );
      await copyIfChanged(
        join(paths.skillSrc, rel),
        join(paths.kimiSkillDst, rel),
        `${LABEL_PREFIX.KIMI_SKILL}${rel}`,
        force,
        result
      );
    }
  }

  for (const orphan of TOOL_ORPHANS) {
    const orphanPath = join(paths.binDst, orphan);
    if (
      (await Bun.file(orphanPath)
        .text()
        .catch(() => null)) !== null
    ) {
      try {
        await Bun.file(orphanPath).delete();
      } catch {
        // Ignore deletion failures (e.g., permission denied).
      }
      result.removed.push(`${LABEL_PREFIX.TOOLS}${orphan}`);
    }
  }

  return result;
}
