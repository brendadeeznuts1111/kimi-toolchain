#!/usr/bin/env bun
/**
 * Print canonical reference tables to the terminal for quick inspection.
 *
 * Usage:
 *   bun run references:inspect
 *   bun run references:inspect --section ecosystem
 *   bun run references:inspect --section repos
 *   bun run references:inspect --section docs
 *   bun run references:inspect --plain          # strip ANSI even when TTY
 *   bun run references:inspect --validate       # run URL lint after printing
 */

import {
  ECOSYSTEM_REFERENCES,
  LOCAL_DOC_REFERENCES,
  REPO_REFERENCES,
  lintRepoUrls,
  repoUrlParts,
} from "../src/lib/canonical-references.ts";

const args = new Set(Bun.argv.slice(2));
const plain = args.has("--plain");
const validate = args.has("--validate");

const section = (() => {
  const idx = Bun.argv.indexOf("--section");
  return idx >= 0 ? Bun.argv[idx + 1] : "all";
})();

function printTable(header: string, table: string): void {
  console.log(`\n${header}:`);
  const shouldStrip = plain || !process.stdout.isTTY;
  console.log(shouldStrip ? Bun.stripANSI(table) : table);
}

const repoNameById = new Map(REPO_REFERENCES.map((r) => [r.id, r.name]));

if (section === "all" || section === "ecosystem") {
  printTable(
    "Ecosystem references",
    Bun.inspect.table(
      ECOSYSTEM_REFERENCES.map((e) => {
        const resolvedRepoId = e.repoId ?? (e.noRepo ? null : `${e.id}-upstream`);
        return {
          id: e.id,
          kind: e.kind,
          package: e.package ?? "—",
          minVersion: e.minVersion ?? "—",
          status: e.status ?? "active",
          repoId: resolvedRepoId ?? "(noRepo)",
          sourceRepo: resolvedRepoId ? (repoNameById.get(resolvedRepoId) ?? "?") : "—",
        };
      })
    )
  );
}

if (section === "all" || section === "repos") {
  printTable(
    "Repository references",
    Bun.inspect.table(
      REPO_REFERENCES.map((r) => ({
        id: r.id,
        role: r.role ?? "—",
        provides: r.provides?.join(", ") ?? "—",
        clonePath: r.clonePath ?? "—",
        source: repoUrlParts(r.url).display,
      }))
    )
  );
}

if (section === "all" || section === "docs") {
  printTable(
    "Local doc references",
    Bun.inspect.table(
      LOCAL_DOC_REFERENCES.map((d) => ({
        id: d.id,
        repoPath: d.repoPath,
        canvas: d.cursorCanvas ? "yes" : "—",
        readOrder: d.canvasReadOrder ?? "—",
      }))
    )
  );
}

if (validate) {
  const violations = lintRepoUrls();
  if (violations.length) {
    console.log("\n\u26a0\ufe0f  URL validation issues:");
    for (const v of violations) console.log(`  - ${v}`);
    process.exit(1);
  } else {
    console.log("\n\u2705 All repo URLs valid.");
  }
}
