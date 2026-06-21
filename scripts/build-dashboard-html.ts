#!/usr/bin/env bun
/**
 * Production HTML build for dashboard pages.
 *
 * Uses Bun.build with HTML entrypoints to inline CSS, bundle JS,
 * and minify output — per official docs:
 * @see https://bun.com/docs/bundler/html-static#build-for-production
 *
 * Usage:
 *   bun run build:dashboard-html
 *   bun run build:dashboard-html --minify
 *   bun run build:dashboard-html --outdir ./dist
 */

import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const minify = Bun.argv.includes("--minify");
const outdirIdx = Bun.argv.indexOf("--outdir");
const outdir = outdirIdx >= 0 ? Bun.argv[outdirIdx + 1]! : join(REPO_ROOT, "dist");

const entrypoints = [
  join(REPO_ROOT, "examples/dashboard/src/dashboard.html"),
  join(REPO_ROOT, "templates/herdr-dashboard.html"),
].filter((p) => Bun.file(p).exists());

if (entrypoints.length === 0) {
  console.error("No dashboard HTML entrypoints found.");
  process.exit(1);
}

const result = await Bun.build({
  entrypoints,
  outdir,
  minify,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Built ${entrypoints.length} HTML entrypoint(s) → ${outdir}`);
for (const output of result.outputs) {
  console.log(`  ${output.kind}: ${output.path} (${output.size} bytes)`);
}
