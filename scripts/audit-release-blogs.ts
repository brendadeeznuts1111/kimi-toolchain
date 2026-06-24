#!/usr/bin/env bun
/**
 * Batch audit: verify each BUN_RELEASE_HISTORY entry against its live blog post.
 *
 *   bun run scripts/audit-release-blogs.ts
 *   bun run scripts/audit-release-blogs.ts --version 1.3.6
 *   bun run scripts/audit-release-blogs.ts --json --quiet
 *   bun run scripts/audit-release-blogs.ts --cache-dir /tmp/bun-blog-audit
 */

import {
  BUN_RELEASE_HISTORY,
  sortReleaseVersions,
  type BunReleaseRecord,
  type BunReleaseVersion,
} from "../src/lib/bun-release-registry.ts";
import { verifyReleaseMeta, type ReleaseMetaDrift } from "./head-table-typed.ts";

export interface ReleaseBlogAuditResult {
  version: string;
  ok: boolean;
  blogUrl: string;
  drifts: ReleaseMetaDrift[];
  error?: string;
}

interface CliOptions {
  versions: string[];
  cacheDir: string;
  json: boolean;
  quiet: boolean;
}

function parseCli(argv: string[]): CliOptions {
  let cacheDir = "/tmp";
  let json = false;
  let quiet = false;
  const versions: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cache-dir") cacheDir = argv[++i] ?? cacheDir;
    else if (arg === "--json") json = true;
    else if (arg === "--quiet") quiet = true;
    else if (arg === "--version") {
      const next = argv[++i];
      if (next) versions.push(next);
    }
  }

  return {
    versions:
      versions.length > 0 ? versions : sortReleaseVersions(Object.keys(BUN_RELEASE_HISTORY)),
    cacheDir,
    json,
    quiet,
  };
}

async function fetchBlogAssets(
  record: BunReleaseRecord,
  cacheDir: string
): Promise<{ md: string; html: string }> {
  const htmlPath = `${cacheDir}/bun-v${record.version}.html`;
  const mdPath = `${cacheDir}/bun-v${record.version}.md`;
  const mdUrl = `${record.blogUrl}.md`;

  const [htmlRes, mdRes] = await Promise.all([fetch(record.blogUrl), fetch(mdUrl)]);
  if (!htmlRes.ok) {
    throw new Error(`HTTP ${htmlRes.status} for ${record.blogUrl}`);
  }
  if (!mdRes.ok) {
    throw new Error(`HTTP ${mdRes.status} for ${mdUrl}`);
  }

  const html = await htmlRes.text();
  const md = await mdRes.text();
  await Promise.all([Bun.write(htmlPath, html), Bun.write(mdPath, md)]);
  return { md, html };
}

/** Verify one registry record against blog markdown (exported for tests). */
export function auditReleaseBlog(md: string, record: BunReleaseRecord): ReleaseMetaDrift[] {
  return verifyReleaseMeta(md, record);
}

export async function auditReleaseVersion(
  version: string,
  cacheDir: string
): Promise<ReleaseBlogAuditResult> {
  const record = BUN_RELEASE_HISTORY[version as BunReleaseVersion];
  if (!record) {
    return {
      version,
      ok: false,
      blogUrl: "",
      drifts: [],
      error: `No registry entry for version ${version}`,
    };
  }

  try {
    const { md } = await fetchBlogAssets(record, cacheDir);
    const drifts = auditReleaseBlog(md, record);
    return {
      version,
      ok: drifts.length === 0,
      blogUrl: record.blogUrl,
      drifts,
    };
  } catch (error) {
    return {
      version,
      ok: false,
      blogUrl: record.blogUrl,
      drifts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const { versions, cacheDir, json, quiet } = parseCli(Bun.argv.slice(2));
  const results: ReleaseBlogAuditResult[] = [];

  for (const version of versions) {
    const result = await auditReleaseVersion(version, cacheDir);
    results.push(result);

    if (!quiet || !result.ok) {
      if (json) continue;
      if (result.ok) {
        console.log(`✅ v${version} — ${result.blogUrl}`);
      } else if (result.error) {
        console.error(`❌ v${version} — ${result.error}`);
      } else {
        const summary = result.drifts.map((d) => d.message).join("; ");
        console.error(`❌ v${version} — ${summary}`);
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;

  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: failed.length === 0,
          passed,
          failed: failed.length,
          cacheDir,
          results,
        },
        null,
        2
      )
    );
  } else if (!quiet || failed.length > 0) {
    console.log(`\n${passed}/${results.length} release blogs verified`);
  }

  if (failed.length > 0) process.exit(1);
}

if (import.meta.main) {
  await main();
}
