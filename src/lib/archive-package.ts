/**
 * archive-package.ts — Final-slot dist packaging after Bun.build.
 *
 * Compresses a build outdir (typically `./dist`) into a gzip tarball via Core
 * `createDistArchive()` — no duplicate glob/tar logic here.
 *
 * @see https://bun.com/docs/runtime/archive
 */

import { dirname } from "path";
import {
  archiveSupported,
  createDistArchive,
  type ArchiveCompressOptions,
  type DistArchiveResult,
} from "./archive-persistence.ts";
import { makeDir } from "./bun-io.ts";

export interface PackageBuildOutputResult extends DistArchiveResult {
  outputPath: string;
}

/** Default distribution package: max gzip (level 9). */
export const DEFAULT_DIST_PACKAGE_OPTS = {
  compress: "gzip",
  level: 9,
} as const satisfies ArchiveCompressOptions;

/**
 * Package a Bun.build outdir into a gzip tarball on disk.
 *
 * @param distDir — directory tree to archive (e.g. `./dist`)
 * @param outputPath — destination `.tar.gz` path
 */
export async function packageBuildOutput(
  distDir: string,
  outputPath: string,
  opts: ArchiveCompressOptions = DEFAULT_DIST_PACKAGE_OPTS
): Promise<PackageBuildOutputResult> {
  if (!archiveSupported()) {
    throw new Error("Bun.Archive is unavailable on this runtime");
  }

  const result = await createDistArchive(distDir, opts);
  makeDir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, result.bytes);

  return { ...result, outputPath };
}
