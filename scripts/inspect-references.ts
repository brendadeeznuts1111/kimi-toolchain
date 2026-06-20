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
 *   bun run references:inspect --json             # machine-readable JSON for jq / CI
 */

import {
  ECOSYSTEM_REFERENCES,
  LOCAL_DOC_REFERENCES,
  REPO_REFERENCES,
  formatCanonicalReferencesInspectPlain,
  lintRepoUrls,
  repoUrlParts,
  type CanonicalReferencesInspectSection,
} from "../src/lib/canonical-references.ts";

const args = new Set(Bun.argv.slice(2));
const plain = args.has("--plain");
const validate = args.has("--validate");
const jsonMode = args.has("--json");

const section = (() => {
  const idx = Bun.argv.indexOf("--section");
  const raw = idx >= 0 ? Bun.argv[idx + 1] : "all";
  return (raw ?? "all") as CanonicalReferencesInspectSection;
})();

function printTable(header: string, table: string): void {
  console.log(`\n${header}:`);
  const shouldStrip = plain || !process.stdout.isTTY;
  console.log(shouldStrip ? Bun.stripANSI(table) : table);
}

const repoNameById = new Map(REPO_REFERENCES.map((r) => [r.id, r.name]));

if (jsonMode) {
  const output: Record<string, unknown> = {};
  if (section === "all" || section === "ecosystem") output.ecosystem = ECOSYSTEM_REFERENCES;
  if (section === "all" || section === "repos") output.repos = REPO_REFERENCES;
  if (section === "all" || section === "docs") output.localDocs = LOCAL_DOC_REFERENCES;
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  process.exit(0);
}

if (plain) {
  process.stdout.write(formatCanonicalReferencesInspectPlain(section) + "\n");
} else if (section === "all" || section === "ecosystem") {
  printTable(
    "Ecosystem references",
    Bun.inspect.table(
      ECOSYSTEM_REFERENCES.map((e) => {
        const resolvedRepoId = e.repoId ?? `${e.id}-upstream`;
        const repoName = repoNameById.get(resolvedRepoId);
        return {
          id: e.id,
          kind: e.kind,
          package: e.package ?? "—",
          minVersion: e.minVersion ?? "—",
          status: e.status ?? "active",
          repoId: e.noRepo ? "(noRepo)" : resolvedRepoId,
          sourceRepo: e.noRepo ? "—" : (repoName ?? "?"),
        };
      })
    )
  );
}

if (!plain && (section === "all" || section === "repos")) {
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

if (!plain && (section === "all" || section === "docs")) {
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
