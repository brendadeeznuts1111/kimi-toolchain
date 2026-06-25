/**
 * Canonical repo → ~/.kimi-code/ sync, hash, manifest, restore (single module).
 */

import { join } from "node:path";
import { pathExists } from "./bun-io.ts";
import {
  archiveSupported,
  extractSyncSnapshotArchive,
  readSyncSnapshotArchiveMetadata,
  writeSyncSnapshotArchive,
} from "./archive-persistence.ts";
import { recordSyncBaselineMetrics } from "./sync-baseline-metrics.ts";
import { collectLocalDocSyncEntries, collectLocalDocSyncPaths } from "./canonical-references.ts";
import { sha256File } from "./hash.ts";
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
  syncBaselineArchivePath,
  syncBaselineCacheArchivePath,
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
    desktopDir: () => `${desktopRoot()}/templates`,
    globs: ["**/*"],
  },
] as const;

export const SKILL_ROUTE = {
  repoSegments: ["skills", "kimi-toolchain"],
  agentsPrefix: LABEL_PREFIX.AGENTS_SKILL,
  kimiPrefix: LABEL_PREFIX.KIMI_SKILL,
  agentsDesktopDir: () => `${agentsSkillsRoot()}/kimi-toolchain`,
  kimiDesktopDir: () => `${skillsDir()}/kimi-toolchain`,
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

export type SyncRunResult = { updated: string[]; removed: string[]; skipped: number };

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
    Bun.spawnSync(["mkdir", "-p", dir]);
  }
}

export async function computeSyncHashes(repoRoot: string): Promise<Record<string, string>> {
  repoRoot = canonicalRepoRoot(repoRoot);
  const hashes: Record<string, string> = {};

  for (const route of SYNC_ROUTES) {
    const srcDir = repoSourceDir(repoRoot, route.repoSegments);
    if (!pathExists(srcDir)) continue;
    for (const pattern of route.globs) {
      const glob = new Bun.Glob(pattern);
      for await (const file of glob.scan({ cwd: srcDir, onlyFiles: true })) {
        hashes[`${route.prefix}${file}`] = await sha256File(join(srcDir, file));
      }
    }
  }

  for (const doc of [...collectLocalDocSyncPaths(), ...SYNC_ROOT_INFRA]) {
    const path = join(repoRoot, doc);
    if (await Bun.file(path).exists()) hashes[doc] = await sha256File(path);
  }

  const skillDir = repoSourceDir(repoRoot, SKILL_ROUTE.repoSegments);
  if (pathExists(skillDir)) {
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
    if (!dstPath || !(await Bun.file(dstPath).exists())) {
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
    if ("optional" in route && route.optional && !pathExists(srcDir)) continue;
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
  if (await Bun.file(skillSrc).exists()) {
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

export type HashDiffResult = {
  missing: string[];
  changed: string[];
  extra: string[];
};

export function diffArchivedHashes(
  archived: Record<string, string>,
  current: Record<string, string>
): HashDiffResult {
  const missing: string[] = [];
  const changed: string[] = [];
  const extra: string[] = [];
  for (const [key, expected] of Object.entries(archived)) {
    const actual = current[key];
    if (!actual) missing.push(key);
    else if (actual !== expected) changed.push(key);
  }
  for (const key of Object.keys(current)) {
    if (!(key in archived)) extra.push(key);
  }
  return { missing: missing.sort(), changed: changed.sort(), extra: extra.sort() };
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
    if (!sourcePath || !(await Bun.file(sourcePath).exists())) continue;
    contents[key] = await Bun.file(sourcePath).bytes();
  }
  const archived = await writeSyncSnapshotArchive(manifest, archivePath, contents);
  return { archiveHash: archived.archiveHash, byteLength: archived.byteLength };
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

  const hashDiff = diffArchivedHashes(manifest?.fileHashes ?? {}, expectedHashes);
  const manifestFresh =
    !!manifest &&
    hashDiff.missing.length === 0 &&
    hashDiff.changed.length === 0 &&
    hashDiff.extra.length === 0;

  return {
    ok: manifestFresh && drift.synced,
    manifestPresent: !!manifest,
    manifestFresh,
    desktopSynced: drift.synced,
    missingHashes: hashDiff.missing,
    changedHashes: hashDiff.changed,
    extraHashes: hashDiff.extra,
    drift,
  };
}

const ARCHIVE_MODE_ALIASES: Record<string, "always" | "never" | "auto"> = {
  always: "always",
  never: "never",
  auto: "auto",
  "1": "always",
  "0": "never",
  true: "always",
  false: "never",
};

export function resolveArchiveMode(
  argv: string[] = Bun.argv,
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>
): "always" | "never" | "auto" {
  if (argv.includes("--no-archive")) return "never";
  const flag = argv.find((arg) => arg.startsWith("--archive="))?.slice("--archive=".length);
  if (flag === "always" || flag === "never" || flag === "auto") return flag;
  const raw = env.KIMI_SYNC_ARCHIVE?.toLowerCase();
  return (raw && ARCHIVE_MODE_ALIASES[raw]) || "auto";
}

export async function shouldWriteArchive(
  repoRoot: string,
  argv: string[] = Bun.argv,
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>
): Promise<boolean> {
  const mode = resolveArchiveMode(argv, env);
  if (mode === "always") return true;
  if (mode === "never") return false;
  const archivePath = syncBaselineCacheArchivePath(repoRoot);
  if (!(await Bun.file(archivePath).exists())) return true;
  const [manifest, currentHead] = await Promise.all([readManifest(), getRepoHead()]);
  return manifest?.gitHead !== currentHead;
}

export async function finalizeSyncArchive(
  repoRoot: string,
  options: { files: string[]; writeArchive?: boolean; archivePath?: string }
): Promise<{
  manifest: ToolchainManifest;
  archived: boolean;
  archiveHash?: string;
  byteLength?: number;
  fileCount: number;
}> {
  const manifest = await buildSyncManifest(repoRoot, { files: options.files });
  await writeManifest(manifest);
  const fileCount = Object.keys(manifest.fileHashes ?? {}).length;
  const writeArchive = options.writeArchive ?? (await shouldWriteArchive(repoRoot));
  if (!writeArchive) return { manifest, archived: false, fileCount };
  if (!archiveSupported()) {
    console.error("[sync] Bun.Archive not available — skipping baseline archive");
    return { manifest, archived: false, fileCount };
  }
  const archivePath = options.archivePath ?? syncBaselineCacheArchivePath(repoRoot);
  const { archiveHash, byteLength } = await writeSyncArchiveBaseline(
    repoRoot,
    archivePath,
    manifest
  );
  await recordSyncBaselineMetrics(repoRoot, {
    ok: true,
    archivePath,
    syncBaselineSize: byteLength,
    syncBaselineHash: archiveHash,
    fileCount,
    toolchainVersion: manifest.toolchainVersion,
    lastSyncedAt: manifest.lastSyncedAt,
  });
  return { manifest, archived: true, archiveHash, byteLength, fileCount };
}

// --- Restore baseline (from Bun.Archive gzip tarball) ---

export type RestoreDriftRow = {
  file: string;
  status: "add" | "remove" | "modify";
  oldHash?: string;
  newHash?: string;
};

export function hashDiffDriftRows(
  archived: Record<string, string>,
  current: Record<string, string>
): RestoreDriftRow[] {
  const diff = diffArchivedHashes(archived, current);
  const rows: RestoreDriftRow[] = [
    ...diff.extra.map((file) => ({ file, status: "add" as const, newHash: current[file] })),
    ...diff.missing.map((file) => ({ file, status: "remove" as const, oldHash: archived[file] })),
    ...diff.changed.map((file) => ({
      file,
      status: "modify" as const,
      oldHash: archived[file],
      newHash: current[file],
    })),
  ];
  rows.sort((a, b) => a.file.localeCompare(b.file) || a.status.localeCompare(b.status));
  return rows;
}

export async function dryRunRestoreBaseline(
  archivePath: string,
  repoRoot: string
): Promise<{ driftRows: RestoreDriftRow[]; hashDiff: HashDiffResult; ok: boolean }> {
  if (!archiveSupported()) throw new Error("Bun.Archive is unavailable on this runtime");
  const archiveFile = Bun.file(archivePath);
  if (!(await archiveFile.exists())) throw new Error(`Archive not found: ${archivePath}`);
  const { fileHashes } = await readSyncSnapshotArchiveMetadata(await archiveFile.bytes());
  const current = await computeSyncHashes(repoRoot);
  const hashDiff = diffArchivedHashes(fileHashes, current);
  const driftRows = hashDiffDriftRows(fileHashes, current);
  const failed =
    hashDiff.missing.length > 0 || hashDiff.changed.length > 0 || hashDiff.extra.length > 0;
  return { driftRows, hashDiff, ok: !failed };
}

export function printRestoreDryRunTable(drift: RestoreDriftRow[]): void {
  if (!drift.length) {
    console.error("[restore] dry-run: no drift detected");
    return;
  }
  console.error(`[restore] dry-run drift (${drift.length} row(s)):`);
  console.error(
    Bun.inspect.table(
      drift.map((d) => ({
        file: d.file,
        status: d.status,
        hash:
          d.oldHash || d.newHash
            ? `${d.oldHash?.slice(0, 8) ?? "—"} → ${d.newHash?.slice(0, 8) ?? "—"}`
            : "—",
      })),
      ["file", "status", "hash"],
      { colors: true }
    )
  );
}

export async function restoreSyncBaseline(options: {
  archivePath?: string;
  repoRoot: string;
  verify?: boolean;
  dryRun?: boolean;
}): Promise<{
  manifest: ToolchainManifest;
  meta: { bunVersion: string; fileCount: number; createdAt: string };
  hashDiff?: HashDiffResult;
  driftRows?: RestoreDriftRow[];
  wroteManifest: boolean;
}> {
  if (!archiveSupported()) throw new Error("Bun.Archive is unavailable on this runtime");
  const archivePath = options.archivePath ?? syncBaselineArchivePath();
  const archiveFile = Bun.file(archivePath);
  if (!(await archiveFile.exists())) throw new Error(`Archive not found: ${archivePath}`);
  const { manifest, meta, fileHashes } = await readSyncSnapshotArchiveMetadata(
    await archiveFile.bytes()
  );

  let hashDiff: HashDiffResult | undefined;
  let driftRows: RestoreDriftRow[] | undefined;
  if (options.verify !== false) {
    const current = await computeSyncHashes(options.repoRoot);
    hashDiff = diffArchivedHashes(fileHashes, current);
    driftRows = hashDiffDriftRows(fileHashes, current);
    const failed =
      hashDiff.missing.length > 0 || hashDiff.changed.length > 0 || hashDiff.extra.length > 0;
    if (failed) {
      const err = new Error(
        `Baseline drift detected (+${hashDiff.missing.length}/-${hashDiff.extra.length}/~${hashDiff.changed.length})`
      ) as Error & { hashDiff: HashDiffResult; driftRows: RestoreDriftRow[] };
      err.hashDiff = hashDiff;
      err.driftRows = driftRows;
      throw err;
    }
  }

  const wroteManifest = !options.dryRun;
  if (wroteManifest) await writeManifest(manifest);

  return {
    manifest,
    meta: {
      bunVersion: meta.bunVersion,
      fileCount: meta.fileCount,
      createdAt: meta.createdAt,
    },
    hashDiff,
    driftRows,
    wroteManifest,
  };
}

export async function restoreBaselineToDir(
  archivePath: string,
  targetDir: string,
  options: { verify?: boolean; dryRun?: boolean } = {}
): Promise<{
  archivePath: string;
  targetDir: string;
  dryRun: boolean;
  verified: boolean;
  manifest: ToolchainManifest;
  restoredFiles: string[];
  restored: number;
  drift: string[];
}> {
  if (!archiveSupported()) throw new Error("Bun.Archive is unavailable on this runtime");
  const archiveFile = Bun.file(archivePath);
  if (!(await archiveFile.exists())) throw new Error(`archive not found: ${archivePath}`);
  const verify = options.verify !== false;
  const dryRun = options.dryRun === true;
  const extractDir = dryRun
    ? join(Bun.env.TMPDIR || "/tmp", `kimi-restore-baseline-${Bun.randomUUIDv7()}`)
    : targetDir;

  try {
    const snapshot = await extractSyncSnapshotArchive(await archiveFile.bytes(), extractDir);
    let drift: string[] = [];
    if (verify) {
      const fileHashes = snapshot.manifest.fileHashes ?? {};
      for (const [file, expectedHash] of Object.entries(fileHashes)) {
        const path = join(extractDir, file);
        if (!(await Bun.file(path).exists())) {
          drift.push(`missing ${file}`);
          continue;
        }
        if ((await sha256File(path)) !== expectedHash) drift.push(`changed ${file}`);
      }
      drift.sort();
      if (drift.length > 0) {
        const err = new Error("hash mismatch post-extract") as Error & {
          drift: string[];
          driftRows: RestoreDriftRow[];
        };
        err.drift = drift;
        err.driftRows = drift.map((line) => ({
          file: line.replace(/^(missing|changed) /, ""),
          status: line.startsWith("missing ") ? ("remove" as const) : ("modify" as const),
        }));
        throw err;
      }
    }
    return {
      archivePath,
      targetDir,
      dryRun,
      verified: verify,
      manifest: snapshot.manifest,
      restoredFiles: snapshot.files,
      restored: snapshot.files.length,
      drift,
    };
  } finally {
    if (dryRun) Bun.spawnSync(["rm", "-rf", extractDir]);
  }
}
