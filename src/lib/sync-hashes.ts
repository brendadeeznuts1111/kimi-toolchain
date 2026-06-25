/**
 * Sync hash utilities — detect repo vs desktop runtime drift.
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { sha256File } from "./utils.ts";
import { canonicalRepoRoot } from "./paths.ts";
import { collectLocalDocSyncPaths } from "./canonical-references.ts";
import { LABEL_PREFIX, SYNC_ROOT_INFRA, resolveSyncManagedDesktopPath } from "./sync-paths.ts";

async function addGlobHashes(
  hashes: Record<string, string>,
  sourceDir: string,
  keyPrefix: string,
  pattern: string
): Promise<void> {
  if (!pathExists(sourceDir)) return;
  const glob = new Bun.Glob(pattern);
  for await (const file of glob.scan({ cwd: sourceDir, onlyFiles: true })) {
    hashes[`${keyPrefix}${file}`] = await sha256File(join(sourceDir, file));
  }
}

/** Compute sha256 hashes for all sync-managed source files. */
export async function computeSyncHashes(repoRoot: string): Promise<Record<string, string>> {
  repoRoot = canonicalRepoRoot(repoRoot);
  const hashes: Record<string, string> = {};

  const binDir = join(repoRoot, "src", "bin");
  const libDir = join(repoRoot, "src", "lib");
  const canvasesDir = join(repoRoot, "src", "canvases");
  const gatesDir = join(repoRoot, "src", "gates");
  const harnessDir = join(repoRoot, "src", "harness");
  const scriptsDir = join(repoRoot, "scripts");
  const kimiHooksDir = join(repoRoot, "src", "kimi-hooks");
  const templatesDir = join(repoRoot, "templates");
  const skillDir = join(repoRoot, "skills", "kimi-toolchain");

  await addGlobHashes(hashes, binDir, LABEL_PREFIX.TOOLS, "*.ts");
  await addGlobHashes(hashes, libDir, LABEL_PREFIX.LIB, "**/*.ts");
  await addGlobHashes(hashes, libDir, LABEL_PREFIX.LIB, "**/*.json");
  await addGlobHashes(hashes, canvasesDir, LABEL_PREFIX.CANVASES, "*.ts");
  await addGlobHashes(hashes, gatesDir, LABEL_PREFIX.GATES, "**/*.ts");
  await addGlobHashes(hashes, harnessDir, LABEL_PREFIX.HARNESS, "**/*.ts");
  await addGlobHashes(hashes, scriptsDir, LABEL_PREFIX.SCRIPTS, "*.ts");
  await addGlobHashes(hashes, kimiHooksDir, LABEL_PREFIX.KIMI_HOOKS, "*.ts");
  await addGlobHashes(hashes, templatesDir, LABEL_PREFIX.TEMPLATES, "**/*");

  for (const doc of collectLocalDocSyncPaths()) {
    const path = join(repoRoot, doc);
    if (pathExists(path)) hashes[doc] = await sha256File(path);
  }

  for (const doc of SYNC_ROOT_INFRA) {
    const path = join(repoRoot, doc);
    if (pathExists(path)) hashes[doc] = await sha256File(path);
  }

  if (pathExists(skillDir)) {
    const skillGlob = new Bun.Glob("**/*");
    for await (const file of skillGlob.scan({ cwd: skillDir, onlyFiles: true })) {
      const hash = await sha256File(join(skillDir, file));
      hashes[`${LABEL_PREFIX.AGENTS_SKILL}${file}`] = hash;
      hashes[`${LABEL_PREFIX.KIMI_SKILL}${file}`] = hash;
    }
  }

  return hashes;
}

export interface SyncDriftReport {
  drifted: string[];
  missing: string[];
  synced: boolean;
}

/** Compare repo hashes against on-disk desktop install. */
export async function detectSyncDrift(repoRoot: string): Promise<SyncDriftReport> {
  repoRoot = canonicalRepoRoot(repoRoot);
  const repoHashes = await computeSyncHashes(repoRoot);
  const drifted: string[] = [];
  const missing: string[] = [];

  for (const [key, repoHash] of Object.entries(repoHashes)) {
    const dstPath = resolveSyncManagedDesktopPath(key);
    if (!dstPath || !pathExists(dstPath)) {
      missing.push(key);
      continue;
    }

    const desktopHash = await sha256File(dstPath);
    if (desktopHash !== repoHash) {
      drifted.push(key);
    }
  }

  return {
    drifted,
    missing,
    synced: drifted.length === 0 && missing.length === 0,
  };
}
