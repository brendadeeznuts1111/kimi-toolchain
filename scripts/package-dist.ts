#!/usr/bin/env bun
/**
 * package-dist.ts — gzip tarball of a Bun.build outdir (default ./dist).
 *
 *   bun run package:dist
 *   bun run package:dist -- ./dist ./release/kimi-toolchain-dist.tar.gz
 */

import { resolve } from "path";
import { packageBuildOutput } from "../src/lib/archive-package.ts";

const args = Bun.argv.slice(2).filter((a) => a !== "--");
const distDir = resolve(args[0] ?? "./dist");
const outputPath = resolve(args[1] ?? "./dist.tar.gz");

const result = await packageBuildOutput(distDir, outputPath);
console.log(
  `[package] ${result.fileCount} file(s) → ${result.outputPath} (${result.bytes.length} bytes, crc32 ${result.hash})`
);
