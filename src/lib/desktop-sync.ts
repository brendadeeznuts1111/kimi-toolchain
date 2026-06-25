/**
 * Canonical repo → ~/.kimi-code/ sync, hash, manifest (single module).
 */

import { writeSyncSnapshotArchive } from "./archive-persistence.ts";
import { collectLocalDocSyncEntries, collectLocalDocSyncPaths } from "./canonical-references.ts";
import { sha256File } from "./hash.ts";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "path";
import {
  desktopRoot,
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
  agentsSkillsRoot,
} from "./paths.ts";
import {
  writeManifest,
  TOOLCHAIN_VERSION,
  getDesktopVersion,
  getRepoHead,
  readManifest,
  type ToolchainManifest,
} from "./version.ts";

/** Manifest hash key prefixes — must match ~/.kimi-code/ layout. */
export const LABEL_PREFIX = {
  TOOLS: "tools/",
  LIB: "lib/",
  CANVASES: "canvases/",
  GATES: "gates/",
  HARNESS: "harness/",
  SCRIPTS: "scripts/",
  KIMI_HOOKS: "kimi-hooks/",
  TEMPLATES: "templates/",
  AGENTS_SKILL: "agents-skill/",
  KIMI_SKILL: "kimi-skill/",
} as const;

export const SYNC_ROOT_INFRA = [
  "CONTRIBUTING.md",
  "dx.config.toml",
  "kimi-toolchain.code-workspace",
  "error-taxonomy.yml",
] as const;

export const SYNC_ROUTES = [
  {
    prefix: LABEL_PREFIX.TOOLS,
    repoSegments: ["src", "bin"],
    desktopDir: toolsDir,
    globs: ["*.ts"],
  },
  {
    prefix: LABEL_PREFIX.LIB,
    repoSegments: ["src", "lib"],
    desktopDir: libDir,
    globs: ["**/*.ts", "**/*.json"],
  },
  {
    prefix: LABEL_PREFIX.CANVASES,
    repoSegments: ["src", "canvases"],
    desktopDir: canvasesDir,
    globs: ["*.ts"],
    optional: true,
  },
  {
    prefix: LABEL_PREFIX.GATES,
    repoSegments: ["src", "gates"],
    desktopDir: gatesDir,
    globs: ["**/*.ts"],
    optional: true,
  },
  {
    prefix: LABEL_PREFIX.HARNESS,
    repoSegments: ["src", "harness"],
    desktopDir: harnessDir,
    globs: ["**/*.ts"],
    optional: true,
  },
  {
    prefix: LABEL_PREFIX.SCRIPTS,
    repoSegments: ["scripts"],
    desktopDir: scriptsDir,
    globs: ["*.ts"],
  },
  {
    prefix: LABEL_PREFIX.KIMI_HOOKS,
    repoSegments: ["src", "kimi-hooks"],
    desktopDir: kimiHooksDir,
    globs: ["*.ts"],
    optional: true,
  },
  {
    prefix: LABEL_PREFIX.TEMPLATES,
    repoSegments: ["templates"],
    desktopDir: () => join(desktopRoot(), "templates"),
    globs: ["**/*"],
  },
] as const;

export const SKILL_ROUTE = {
  repoSegments: ["skills", "kimi-toolchain"],
  agentsPrefix: LABEL_PREFIX.AGENTS_SKILL,
  kimiPrefix: LABEL_PREFIX.KIMI_SKILL,
  agentsDesktopDir: () => join(agentsSkillsRoot(), "kimi-toolchain"),
  kimiDesktopDir: () => join(skillsDir(), "kimi-toolchain"),
} as const;

export const OPTIONAL_CONFIG_FILES = ["bunfig.toml", ".gitignore"] as const;
export const TOOL_ORPHANS = ["kimi-utils.ts"] as const;

export function repoSourceDir(repoRoot: string, segments: readonly string[]): string {
  return join(canonicalRepoRoot(repoRoot), ...segments);
}

export function resolveSyncManagedSourcePath(repoRoot: string, key: string): string | null {
  const root = canonicalRepoRoot(repoRoot);
  for (const route of SYNC_ROUTES) {
    if (key.startsWith(route.prefix)) {
      return join(root, ...route.repoSegments, key.slice(route.prefix.length));
    }
  }
  if (key.startsWith(SKILL_ROUTE.agentsPrefix)) {
    return join(root, ...SKILL_ROUTE.repoSegments, key.slice(SKILL_ROUTE.agentsPrefix.length));
  }
  if (key.startsWith(SKILL_ROUTE.kimiPrefix)) {
    return join(root, ...SKILL_ROUTE.repoSegments, key.slice(SKILL_ROUTE.kimiPrefix.length));
  }
  if (
    collectLocalDocSyncPaths().includes(key) ||
    (SYNC_ROOT_INFRA as readonly string[]).includes(key)
  ) {
    return join(root, key);
  }
  return null;
}

export function resolveSyncManagedDesktopPath(key: string): string | null {
  for (const route of SYNC_ROUTES) {
    if (key.startsWith(route.prefix)) {
      return join(route.desktopDir(), key.slice(route.prefix.length));
    }
  }
  if (key.startsWith(SKILL_ROUTE.agentsPrefix)) {
    return join(SKILL_ROUTE.agentsDesktopDir(), key.slice(SKILL_ROUTE.agentsPrefix.length));
  }
  if (key.startsWith(SKILL_ROUTE.kimiPrefix)) {
    return join(SKILL_ROUTE.kimiDesktopDir(), key.slice(SKILL_ROUTE.kimiPrefix.length));
  }
  if (
    collectLocalDocSyncPaths().includes(key) ||
    (SYNC_ROOT_INFRA as readonly string[]).includes(key)
  ) {
    return join(desktopRoot(), key);
  }
  return null;
}

type SyncRunResult = { updated: string[]; removed: string[]; skipped: number };

async function copyTextIfChanged(
  srcPath: string,
  dstPath: string,
  label: string,
  force: boolean,
  result: SyncRunResult
): Promise<void> {
  const srcText = await Bun.file(srcPath)
    .text()
    .catch(() => null);
  if (srcText === null) return;
  const dstText = await Bun.file(dstPath)
    .text()
    .catch(() => null);
  if (force || srcText !== dstText) {
    mkdirSync(dirname(dstPath), { recursive: true });
    await Bun.write(dstPath, srcText);
    result.updated.push(label);
  } else {
    result.skipped++;
  }
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
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export async function computeSyncHashes(repoRoot: string): Promise<Record<string, string>> {
  repoRoot = canonicalRepoRoot(repoRoot);
  const hashes: Record<string, string> = {};

  for (const route of SYNC_ROUTES) {
    const srcDir = repoSourceDir(repoRoot, route.repoSegments);
    if (!existsSync(srcDir)) continue;
    for (const pattern of route.globs) {
      const glob = new Bun.Glob(pattern);
      for await (const file of glob.scan({ cwd: srcDir, onlyFiles: true })) {
        hashes[`${route.prefix}${file}`] = await sha256File(join(srcDir, file));
      }
    }
  }

  for (const doc of [...collectLocalDocSyncPaths(), ...SYNC_ROOT_INFRA]) {
    const path = join(repoRoot, doc);
    if (existsSync(path)) hashes[doc] = await sha256File(path);
  }

  const skillDir = repoSourceDir(repoRoot, SKILL_ROUTE.repoSegments);
  if (existsSync(skillDir)) {
    const skillGlob = new Bun.Glob("**/*");
    for await (const file of skillGlob.scan({ cwd: skillDir, onlyFiles: true })) {
      const hash = await sha256File(join(skillDir, file));
      hashes[`${SKILL_ROUTE.agentsPrefix}${file}`] = hash;
      hashes[`${SKILL_ROUTE.kimiPrefix}${file}`] = hash;
    }
  }

  return hashes;
}

export async function detectSyncDrift(repoRoot: string): Promise<{
  drifted: string[];
  missing: string[];
  synced: boolean;
}> {
  const repoHashes = await computeSyncHashes(repoRoot);
  const drifted: string[] = [];
  const missing: string[] = [];

  for (const [key, repoHash] of Object.entries(repoHashes)) {
    const dstPath = resolveSyncManagedDesktopPath(key);
    if (!dstPath || !existsSync(dstPath)) {
      missing.push(key);
      continue;
    }
    const desktopHash = await sha256File(dstPath);
    if (desktopHash !== repoHash) drifted.push(key);
  }

  return { drifted, missing, synced: drifted.length === 0 && missing.length === 0 };
}

export async function syncDesktop(
  repoRoot: string,
  options: { force?: boolean } = {}
): Promise<SyncRunResult> {
  repoRoot = canonicalRepoRoot(repoRoot);
  const force = options.force ?? false;
  const result: SyncRunResult = { updated: [], removed: [], skipped: 0 };

  ensureDesktopLayout();

  for (const route of SYNC_ROUTES) {
    const srcDir = repoSourceDir(repoRoot, route.repoSegments);
    if ("optional" in route && route.optional && !existsSync(srcDir)) continue;
    const dstDir = route.desktopDir();
    for (const pattern of route.globs) {
      const glob = new Bun.Glob(pattern);
      for await (const file of glob.scan({ cwd: srcDir, onlyFiles: true })) {
        await copyTextIfChanged(
          join(srcDir, file),
          join(dstDir, file),
          `${route.prefix}${file}`,
          force,
          result
        );
      }
    }
  }

  for (const doc of collectLocalDocSyncEntries()) {
    await copyTextIfChanged(
      join(repoRoot, doc.repoPath),
      join(desktopRoot(), doc.repoPath),
      doc.repoPath,
      force,
      result
    );
  }

  for (const file of SYNC_ROOT_INFRA) {
    await copyTextIfChanged(join(repoRoot, file), join(desktopRoot(), file), file, force, result);
  }

  for (const file of OPTIONAL_CONFIG_FILES) {
    const srcPath = join(repoRoot, file);
    const dstPath = join(desktopRoot(), file);
    if (force) {
      await copyTextIfChanged(srcPath, dstPath, file, true, result);
    } else if (!(await Bun.file(dstPath).exists()) && (await Bun.file(srcPath).exists())) {
      await Bun.write(dstPath, await Bun.file(srcPath).text());
      result.updated.push(file);
    }
  }

  const skillSrc = repoSourceDir(repoRoot, SKILL_ROUTE.repoSegments);
  if (existsSync(skillSrc)) {
    const skillGlob = new Bun.Glob("**/*");
    for await (const rel of skillGlob.scan({ cwd: skillSrc, onlyFiles: true })) {
      for (const [dstDir, prefix] of [
        [SKILL_ROUTE.agentsDesktopDir(), SKILL_ROUTE.agentsPrefix],
        [SKILL_ROUTE.kimiDesktopDir(), SKILL_ROUTE.kimiPrefix],
      ] as const) {
        await copyTextIfChanged(
          join(skillSrc, rel),
          join(dstDir, rel),
          `${prefix}${rel}`,
          force,
          result
        );
      }
    }
  }

  for (const orphan of TOOL_ORPHANS) {
    const orphanPath = join(toolsDir(), orphan);
    if (await Bun.file(orphanPath).exists()) {
      await Bun.file(orphanPath)
        .delete()
        .catch(() => {});
      result.removed.push(`${LABEL_PREFIX.TOOLS}${orphan}`);
    }
  }

  return result;
}

export async function buildSyncManifest(
  repoRoot: string,
  options: { files?: string[] } = {}
): Promise<ToolchainManifest> {
  const [desktopVersion, gitHead, fileHashes] = await Promise.all([
    getDesktopVersion(),
    getRepoHead(),
    computeSyncHashes(repoRoot),
  ]);
  return {
    toolchainVersion: TOOLCHAIN_VERSION,
    desktopVersion,
    gitHead,
    lastSyncedAt: new Date().toISOString(),
    files: options.files ?? [],
    fileHashes,
  };
}

export async function writeSyncArchiveBaseline(
  repoRoot: string,
  archivePath: string,
  manifest: ToolchainManifest
): Promise<{ archiveHash: string; byteLength: number }> {
  const contents: Record<string, Uint8Array> = {};
  for (const key of Object.keys(manifest.fileHashes ?? {})) {
    const sourcePath = resolveSyncManagedSourcePath(repoRoot, key);
    if (!sourcePath || !existsSync(sourcePath)) continue;
    contents[key] = await Bun.file(sourcePath).bytes();
  }
  const archived = await writeSyncSnapshotArchive(manifest, archivePath, contents);
  return { archiveHash: archived.archiveHash, byteLength: archived.byteLength };
}

export async function writeSyncManifestWithArchive(
  repoRoot: string,
  archivePath: string,
  options: { files?: string[] } = {}
): Promise<{ manifest: ToolchainManifest; archiveHash: string; byteLength: number }> {
  const manifest = await buildSyncManifest(repoRoot, options);
  await writeManifest(manifest);
  const archived = await writeSyncArchiveBaseline(repoRoot, archivePath, manifest);
  return { manifest, ...archived };
}

export async function verifySyncManifest(repoRoot: string): Promise<{
  ok: boolean;
  manifestPresent: boolean;
  manifestFresh: boolean;
  desktopSynced: boolean;
  missingHashes: string[];
  changedHashes: string[];
  extraHashes: string[];
  drift: Awaited<ReturnType<typeof detectSyncDrift>>;
}> {
  const [manifest, expectedHashes, drift] = await Promise.all([
    readManifest(),
    computeSyncHashes(repoRoot),
    detectSyncDrift(repoRoot),
  ]);

  const manifestHashes = manifest?.fileHashes ?? {};
  const missingHashes: string[] = [];
  const changedHashes: string[] = [];
  const extraHashes: string[] = [];

  for (const [key, expected] of Object.entries(expectedHashes)) {
    const actual = manifestHashes[key];
    if (!actual) missingHashes.push(key);
    else if (actual !== expected) changedHashes.push(key);
  }
  for (const key of Object.keys(manifestHashes)) {
    if (!(key in expectedHashes)) extraHashes.push(key);
  }

  const manifestFresh =
    !!manifest &&
    missingHashes.length === 0 &&
    changedHashes.length === 0 &&
    extraHashes.length === 0;

  return {
    ok: manifestFresh && drift.synced,
    manifestPresent: !!manifest,
    manifestFresh,
    desktopSynced: drift.synced,
    missingHashes: missingHashes.sort(),
    changedHashes: changedHashes.sort(),
    extraHashes: extraHashes.sort(),
    drift,
  };
}
