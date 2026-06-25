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
 *   bun run references:inspect --health         # audit repo + runtime health
 */

import {
  ECOSYSTEM_REFERENCES,
  LOCAL_DOC_REFERENCES,
  REPO_REFERENCES,
  auditCanonicalReferencesHealth,
  ecosystemReferenceInspectRow,
  formatCanonicalReferencesInspectPlain,
  lintRepoUrls,
  repoCanonicalReferencesPath,
  repoUrlParts,
  type CanonicalReferencesInspectSection,
} from "../src/lib/canonical-references.ts";
import { canonicalReferencesPath, homeDir } from "../src/lib/paths.ts";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

const args = new Set(Bun.argv.slice(2));

const section = (() => {
  const idx = Bun.argv.indexOf("--section");
  const raw = idx >= 0 ? Bun.argv[idx + 1] : "all";
  return (raw ?? "all") as CanonicalReferencesInspectSection;
})();

const plain = args.has("--plain");
const validate = args.has("--validate");
const jsonMode = args.has("--json");
const healthMode = args.has("--health");

if (args.has("--watch")) {
  console.error("references:inspect watch mode removed: Bun.watch is unavailable in this runtime");
  process.exit(1);
}

function printTable(header: string, table: string): void {
  console.log(`\n${header}:`);
  const shouldStrip = plain || !process.stdout.isTTY;
  console.log(shouldStrip ? Bun.stripANSI(table) : table);
}

const repoNameById = new Map(REPO_REFERENCES.map((r) => [r.id, r.name]));

if (healthMode) {
  const home = homeDir();
  const report = await auditCanonicalReferencesHealth(REPO_ROOT, home);
  if (!report.applicable) {
    console.log("Canonical references health not applicable for this project.");
    process.exit(0);
  }
  console.log(`repo manifest: ${repoCanonicalReferencesPath(REPO_ROOT)}`);
  console.log(`runtime cache: ${canonicalReferencesPath(home)}`);
  function fixForCheck(name: string, fixable: boolean): string {
    if (!fixable) return "—";
    if (name.startsWith("runtime-")) return "bun run sync";
    if (name.startsWith("repo-")) return "bun run references:generate";
    if (name === "package-pointer") return "(informational)";
    return "—";
  }

  const table = Bun.inspect.table(
    report.checks.map((c) => ({
      name: c.name,
      status: c.status,
      message: c.message,
      fix: fixForCheck(c.name, c.fixable),
    }))
  );
  printTable("Canonical references health", table);
  console.log(`\naligned: ${report.aligned}`);
  if (report.fixPlan.length > 0) {
    console.log(`fix plan: ${[...new Set(report.fixPlan)].join(" → ")}`);
  }
  if (!report.aligned) process.exit(1);
  process.exit(0);
}

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
      ECOSYSTEM_REFERENCES.map((e) => ecosystemReferenceInspectRow(e, repoNameById))
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
