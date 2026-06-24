#!/usr/bin/env bun
/**
 * Inspect oven-sh/bun → kimi-toolchain test port catalog.
 *
 *   bun run scripts/inspect-bun-upstream-refs.ts
 *   bun run scripts/inspect-bun-upstream-refs.ts --format json
 */

import { join } from "path";
import {
  auditCliAlignment,
  auditCliCaseAlignment,
  buildCliPortRefRows,
  BUN_UPSTREAM_TEST_CLI_TREE_URL,
  BUN_UPSTREAM_TEST_COMMIT,
  BUN_UPSTREAM_TEST_REFS,
  BUN_UPSTREAM_TEST_TREE_URL,
  buildCliAlignmentRows,
  buildUpstreamCliSectionRows,
  buildUpstreamTestRefRows,
  upstreamBlobUrl,
} from "../src/lib/bun-upstream-test-refs.ts";
import { renderReleaseTable } from "../src/lib/bun-release-inspect.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function parseFormat(argv: string[]): "table" | "json" {
  return argv.includes("--format") && argv[argv.indexOf("--format") + 1] === "json"
    ? "json"
    : "table";
}

async function main(): Promise<void> {
  const format = parseFormat(Bun.argv.slice(2));
  const rows = buildUpstreamTestRefRows();

  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          commit: BUN_UPSTREAM_TEST_COMMIT,
          treeUrl: BUN_UPSTREAM_TEST_TREE_URL,
          cliTreeUrl: BUN_UPSTREAM_TEST_CLI_TREE_URL,
          cliSections: buildUpstreamCliSectionRows(),
          cliAlignment: auditCliAlignment(),
          cliCaseAlignment: auditCliCaseAlignment(),
          cliAlignmentRows: buildCliAlignmentRows(),
          cliPortRefs: buildCliPortRefRows(),
          refs: BUN_UPSTREAM_TEST_REFS,
          rows,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`oven-sh/bun test @ ${BUN_UPSTREAM_TEST_COMMIT.slice(0, 12)}…`);
  console.log(BUN_UPSTREAM_TEST_TREE_URL);
  console.log(BUN_UPSTREAM_TEST_CLI_TREE_URL);
  console.log();
  console.log(
    renderReleaseTable(rows, ["id", "upstreamPath", "cases", "kimiTest"], {
      colors: false,
      sorted: true,
      depth: 0,
    })
  );
  console.log();
  console.log("test/cli sections:");
  console.log(
    renderReleaseTable(buildUpstreamCliSectionRows(), ["name", "kind", "path", "notes"], {
      colors: false,
      sorted: true,
      depth: 0,
    })
  );

  const alignment = auditCliAlignment();
  const caseAlignment = auditCliCaseAlignment();
  console.log();
  console.log(
    `test/cli files: ${alignment.percent}% (${alignment.covered}/${alignment.total}) · cases: ${caseAlignment.cataloguedPercent}% (${caseAlignment.totalCases}) · depth: ${caseAlignment.depthWeightedPercent}% · ported: ${caseAlignment.portedPercent}%`
  );
  console.log("ported refs:");
  console.log(
    renderReleaseTable(
      buildCliPortRefRows(),
      ["id", "upstreamPath", "cases", "probes", "kimiTest"],
      {
        colors: false,
        sorted: true,
        depth: 0,
      }
    )
  );
  console.log(
    renderReleaseTable(buildCliAlignmentRows(), ["section", "files", "kind", "kimiTest"], {
      colors: false,
      sorted: true,
      depth: 0,
    })
  );

  for (const ref of BUN_UPSTREAM_TEST_REFS) {
    const moduleExists = await Bun.file(join(REPO_ROOT, ref.kimiModule)).exists();
    const testExists = await Bun.file(join(REPO_ROOT, ref.kimiTest)).exists();
    if (!moduleExists || !testExists) {
      console.error(
        `✗ missing local port for ${ref.id}: module=${moduleExists} test=${testExists}`
      );
      process.exit(1);
    }
    console.log(`\n${ref.id}`);
    console.log(`  upstream: ${upstreamBlobUrl(ref.upstreamPath)}`);
    console.log(`  cases: ${ref.upstreamCases.join(", ")}`);
    if (ref.notes) console.log(`  notes: ${ref.notes}`);
  }

  console.log("\n✅ All kimi ports present on disk.");
}

if (import.meta.main) {
  await main();
}
