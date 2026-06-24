#!/usr/bin/env bun
/**
 * Gate: oven-sh/bun test/cli manifest coverage must be 100% @ pinned commit.
 *
 *   bun run validate:bun-cli-alignment
 *   bun run validate:bun-cli-alignment --live   # also diff GitHub tree
 */

import {
  auditCliAlignment,
  auditCliCaseAlignment,
  BUN_UPSTREAM_CLI_TEST_FILES,
  BUN_UPSTREAM_TEST_COMMIT,
} from "../src/lib/bun-upstream-test-refs.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function fetchLiveCliTestFiles(): Promise<string[]> {
  const url = `https://api.github.com/repos/oven-sh/bun/git/trees/${BUN_UPSTREAM_TEST_COMMIT}?recursive=1`;
  const res = await fetch(url);
  if (!res.ok) {
    fail(`GitHub tree fetch failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { tree: Array<{ path: string; type: string }> };
  return body.tree
    .filter(
      (e) => e.type === "blob" && e.path.startsWith("test/cli/") && /\.test\.(ts|js)$/.test(e.path)
    )
    .map((e) => e.path)
    .sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
  const live = Bun.argv.includes("--live");
  const fileReport = auditCliAlignment();
  const caseReport = auditCliCaseAlignment();

  if (!fileReport.aligned) {
    fail(
      `test/cli file alignment ${fileReport.percent}% — uncovered:\n${fileReport.uncovered.map((p) => `  - ${p}`).join("\n")}`
    );
  }

  if (!caseReport.aligned) {
    fail(
      `test/cli case alignment ${caseReport.cataloguedPercent}% — uncovered:\n${caseReport.uncovered.slice(0, 10).join("\n")}`
    );
  }

  if (live) {
    const remote = await fetchLiveCliTestFiles();
    const local = [...BUN_UPSTREAM_CLI_TEST_FILES].sort((a, b) => a.localeCompare(b));
    const missing = remote.filter((p) => !local.includes(p));
    const extra = local.filter((p) => !remote.includes(p));
    if (missing.length > 0 || extra.length > 0) {
      fail(
        `Frozen manifest drift vs GitHub @ ${BUN_UPSTREAM_TEST_COMMIT.slice(0, 12)}:\n` +
          (missing.length ? `  missing locally: ${missing.join(", ")}\n` : "") +
          (extra.length ? `  extra locally: ${extra.join(", ")}\n` : "") +
          "Regenerate src/lib/bun-upstream-cli-manifest.json"
      );
    }
    console.log(`✅ Live tree matches frozen manifest (${remote.length} files).`);
  }

  console.log(
    `✅ test/cli files ${fileReport.percent}% (${fileReport.covered}/${fileReport.total}) · cases ${caseReport.cataloguedPercent}% (${caseReport.totalCases}) · depth ${caseReport.depthWeightedPercent}% · ported ${caseReport.portedPercent}% @ ${BUN_UPSTREAM_TEST_COMMIT.slice(0, 12)}`
  );
}

if (import.meta.main) {
  await main();
}
