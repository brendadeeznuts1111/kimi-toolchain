#!/usr/bin/env bun
/**
 * Validate Bun release registry consistency, stray literals, and live blog alignment.
 *
 *   bun run scripts/validate-release-ssot.ts
 *   bun run scripts/validate-release-ssot.ts --skip-blog-audit
 *
 * Escape hatch: KIMI_SKIP_RELEASE_BLOG_AUDIT=1
 */

import { Glob, semver } from "bun";
import { join } from "path";
import { auditReleaseVersion, type ReleaseBlogAuditResult } from "./audit-release-blogs.ts";
import { formatTable } from "../src/lib/inspect.ts";
import {
  BUN_RELEASE,
  BUN_RELEASE_HISTORY,
  BUN_RELEASE_PREVIOUS,
  sortReleaseVersions,
} from "../src/lib/bun-release-registry.ts";

const RELEASE_LITERAL_ALLOWLIST = new Set(["src/lib/bun-release-registry.ts"]);
const DEFAULT_CACHE_DIR = "/tmp";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseCli(argv: string[]): { skipBlogAudit: boolean } {
  return {
    skipBlogAudit:
      argv.includes("--skip-blog-audit") || Bun.env.KIMI_SKIP_RELEASE_BLOG_AUDIT === "1",
  };
}

function validateRegistryStructure(): string {
  const sorted = sortReleaseVersions(Object.keys(BUN_RELEASE_HISTORY));
  const activeTagLiteral = BUN_RELEASE.tag;
  const latest = sorted.at(-1);

  if (!latest || BUN_RELEASE.version !== latest) {
    fail(
      `BUN_RELEASE (${BUN_RELEASE.version}) is not the latest in history (${latest ?? "none"}). Update bun-release-registry.ts.`
    );
  }

  if (!BUN_RELEASE_HISTORY[BUN_RELEASE_PREVIOUS.version as keyof typeof BUN_RELEASE_HISTORY]) {
    fail("BUN_RELEASE_PREVIOUS is not in BUN_RELEASE_HISTORY.");
  }

  if (semver.order(BUN_RELEASE.version, BUN_RELEASE_PREVIOUS.version) !== 1) {
    fail(
      `BUN_RELEASE (${BUN_RELEASE.version}) must be greater than BUN_RELEASE_PREVIOUS (${BUN_RELEASE_PREVIOUS.version}).`
    );
  }

  const currentIdx = sorted.indexOf(BUN_RELEASE.version);
  const previousIdx = sorted.indexOf(BUN_RELEASE_PREVIOUS.version);
  if (previousIdx !== currentIdx - 1) {
    fail(
      `BUN_RELEASE_PREVIOUS (${BUN_RELEASE_PREVIOUS.version}) must be one semver step before BUN_RELEASE (${BUN_RELEASE.version}).`
    );
  }

  return activeTagLiteral;
}

async function findStrayReleaseLiterals(activeTagLiteral: string): Promise<string[]> {
  const repoRoot = join(import.meta.dir, "..");
  const stray: string[] = [];

  for await (const rel of new Glob("src/**/*.ts").scan({ cwd: repoRoot, onlyFiles: true })) {
    if (RELEASE_LITERAL_ALLOWLIST.has(rel)) continue;
    const text = await Bun.file(join(repoRoot, rel)).text();
    for (const line of text.split("\n")) {
      if (line.includes(activeTagLiteral)) {
        stray.push(rel);
        break;
      }
    }
  }

  return stray;
}

export function collectFailedBlogAudits(
  results: ReleaseBlogAuditResult[]
): ReleaseBlogAuditResult[] {
  return results.filter((result) => !result.ok || result.drifts.length > 0);
}

export async function auditHistoricalReleaseBlogs(
  cacheDir = DEFAULT_CACHE_DIR
): Promise<ReleaseBlogAuditResult[]> {
  const versions = sortReleaseVersions(Object.keys(BUN_RELEASE_HISTORY));
  const results: ReleaseBlogAuditResult[] = [];
  for (const version of versions) {
    results.push(await auditReleaseVersion(version, cacheDir));
  }
  return results;
}

async function main(): Promise<void> {
  const { skipBlogAudit } = parseCli(Bun.argv.slice(2));
  const activeTagLiteral = validateRegistryStructure();

  const stray = await findStrayReleaseLiterals(activeTagLiteral);
  if (stray.length > 0) {
    fail(
      `Stray ${activeTagLiteral} literals outside SSOT:\n${stray.map((f) => `  - ${f}`).join("\n")}`
    );
  }

  console.log("✅ Release registry is consistent.");

  if (skipBlogAudit) {
    console.log("⏭ Skipping historical release blog audit.");
    console.log("✅ SSOT validation complete.");
    return;
  }

  console.log("🔍 Auditing historical release blogs...");
  const results = await auditHistoricalReleaseBlogs();
  const failed = collectFailedBlogAudits(results);

  if (failed.length > 0) {
    console.error("❌ Historical blog drift detected:\n");
    for (const entry of failed) {
      if (entry.error) {
        console.error(`  ${entry.version}: ${entry.error}`);
        continue;
      }
      if (entry.drifts.length > 0) {
        console.error(`  ${entry.version} — ${entry.blogUrl}`);
        console.error(
          formatTable(entry.drifts as unknown as Record<string, unknown>[], [
            "field",
            "expected",
            "actual",
            "message",
          ])
        );
        console.error("");
      }
    }
    process.exit(1);
  }

  console.log(`✅ All ${results.length} release blogs verified.`);
  console.log("✅ SSOT validation complete.");
}

if (import.meta.main) {
  await main();
}
