#!/usr/bin/env bun
/**
 * make-completion-matrix.ts
 *
 * Reads completions/bun-cli.json and produces:
 *   - completions/COMPLETION_MATRIX.md   (human-readable flag taxonomy)
 *   - completions/DYNAMIC_SOURCES.json   (machine-readable dynamic completion contract)
 *   - completions/flag-taxonomy.json     (flag category coverage report)
 *   - completions/COMPLETION_MATRIX.csv  (spreadsheet export)
 *   - completions/COMPLETION_MATRIX.html (self-contained dashboard)
 *
 * Enhanced with Bun-native APIs throughout:
 *   Bun.file / Bun.write / Bun.SHA256 / Bun.inspect.table / Bun.stringWidth
 *   Bun.which / Bun.$ / Bun.main / Bun.version / Bun.gzip
 *   Bun.deepEquals / Bun.env
 *
 * Run via:
 *   bun run scripts/make-completion-matrix.ts              # writes md/json/csv/html
 *   bun run completions:matrix                             # npm alias
 *   bun run completions:matrix --no-csv --no-html          # only md/json
 *   bun run completions:matrix --dry-run                   # compute, do not write
 *   bun run completions:matrix --check                     # CI: exit 1 if stale
 *   BUN_COMPLETION_BACKUP=1 bun run completions:matrix     # also gzip backup
 */

import { $ } from "bun";
import {
  bool,
  buildDynamicSources,
  buildPmRows,
  buildTopLevelRows,
  flagsTable,
  inheritsGlobals,
  makeCsv,
  makeHtmlReport,
  makeTable,
  positionalArgsTable,
  totalSurface,
  criticalInheritedFlags,
  type CompletionData,
} from "../src/completions/completion-matrix.ts";
import { buildTaxonomyCoverage } from "../src/completions/taxonomy-coverage.ts";

// ── Constants ───────────────────────────────────────────────────
const JSON_PATH = "completions/bun-cli.json";
const MATRIX_PATH = "completions/COMPLETION_MATRIX.md";
const DYNAMIC_SOURCES_PATH = "completions/DYNAMIC_SOURCES.json";
const CSV_PATH = "completions/COMPLETION_MATRIX.csv";
const HTML_PATH = "completions/COMPLETION_MATRIX.html";
const TAXONOMY_PATH = "completions/flag-taxonomy.json";

// ── CLI options ─────────────────────────────────────────────────
const args = Bun.argv.slice(2);
const dryRun = args.includes("--dry-run");
const checkMode = args.includes("--check");
const noCsv = args.includes("--no-csv");
const noHtml = args.includes("--no-html");
const writeCsv = !noCsv;
const writeHtml = !noHtml;

// ── Bun-native guard: only run as main module ───────────────────
if (!Bun.main) {
  console.error("❌ Must be run as main module");
  process.exit(1);
}

// ── Verify bun binary in PATH ───────────────────────────────────
const bunPath = Bun.which("bun");
if (!bunPath) {
  console.error("❌ bun not found in PATH");
  process.exit(1);
}

// ── Fetch live Bun version + revision via Bun.$ ────────────────
let liveBunVersion = Bun.version;
let liveBunRevision = Bun.revision;
try {
  const versionProc = await $`bun --version`.quiet();
  liveBunVersion = versionProc.text().trim();
  const revisionProc = await $`bun --revision`.quiet();
  liveBunRevision = revisionProc.text().trim();
} catch {
  // Fallback to Bun.version / Bun.revision constants
}

// ── Bun-native file read ────────────────────────────────────────
const rawJson = await Bun.file(JSON_PATH).text();

// ── Bun-native SHA-256 (12-char hash for matrix alignment) ──────
const jsonHash = Bun.SHA256.hash(rawJson, "hex").slice(0, 12);

// ── Parse ───────────────────────────────────────────────────────
const data = JSON.parse(rawJson);
const typedData = data as CompletionData;

// ── Build rows ──────────────────────────────────────────────────
const topLevelRows = buildTopLevelRows(typedData.commands, jsonHash);
const pmRows = buildPmRows(typedData.commands.pm, jsonHash);

// ── Terminal diagnostics via Bun.inspect.table ──────────────────
function logDiagnosticsTable(label: string, rows: Record<string, unknown>[]) {
  console.log(`\n📊 ${label}`);
  console.log(
    Bun.inspect.table(rows, {
      colors: true,
    })
  );
}

logDiagnosticsTable("Top-level command summary", topLevelRows.slice(0, 6));
logDiagnosticsTable("PM subcommand summary", pmRows.slice(0, 6));

function resolvePmPath(path: string) {
  const parts = path.split(" ");
  let target: typeof typedData.commands.pm | undefined = typedData.commands.pm;
  for (let i = 1; i < parts.length; i++) {
    target = target?.subcommands?.[parts[i]];
  }
  return target;
}

// ── Assemble markdown ───────────────────────────────────────────
const output = [
  "# Bun CLI Completion Behavior Matrix",
  "",
  `Generated from \`completions/bun-cli.json\` (schema v${typedData.version}, Bun ${liveBunVersion}, revision ${liveBunRevision}, hash \`${jsonHash}\`).`,
  "",
  "## Top-level commands",
  "",
  makeTable(topLevelRows),
  "",
  "## `bun pm` subcommands",
  "",
  makeTable(pmRows),
  "",
  "## Global flag inheritance by command",
  "",
  "| Command | Inherits global | Own flags | Total surface | Isolated | Critical inherited |",
  "| --- | --- | --- | --- | --- | --- |",
  ...Object.entries(typedData.commands)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, cmd]) => {
      const isolated = !inheritsGlobals(name);
      return `| ${name} | ${isolated ? "—" : typedData.globalFlags.length} | ${cmd.flags.length} | ${isolated ? cmd.flags.length : totalSurface(cmd, typedData.globalFlags.length)} | ${isolated ? "Yes" : "No"} | ${isolated ? "—" : criticalInheritedFlags(name, typedData.globalFlags, typedData.commands)} |`;
    }),
  "",
  "## Global flags",
  "",
  `- Total: ${typedData.globalFlags.length}`,
  "",
  "## Special handling",
  "",
  "| Scenario | Behavior |",
  "| --- | --- |",
  "| Bare `bun` | Runs files, scripts, and binaries |",
  "| `bun run` | Completes scripts, files, and binaries |",
  "| `bun add` | Completes registry packages |",
  "| `bun remove` | Completes installed packages |",
  "| `bun create` | Completes templates |",
  "| `bun test` / `bun build` | Completes files |",
  "",
  "## `bun getcompletes`",
  "",
  `Available: ${bool(typedData.bunGetCompletes.available)}`,
];

if (typedData.bunGetCompletes.available) {
  const cmds = typedData.bunGetCompletes.commands;
  if (cmds) {
    output.push(
      "",
      "| Provider | Command |",
      "| --- | --- |",
      `| Scripts | \`${cmds.scripts}\` |`,
      `| Binaries | \`${cmds.binaries}\` |`,
      `| Packages | \`${cmds.packages}\` |`,
      `| Files | \`${cmds.files}\` |`
    );
  }
}

output.push(
  "",
  "## Detailed command breakdowns",
  "",
  "### `bun pm version`",
  "",
  positionalArgsTable(resolvePmPath("pm version")),
  "",
  "### `bun pm pkg set`",
  "",
  positionalArgsTable(resolvePmPath("pm pkg set")),
  "",
  "### `bun pm pkg get`",
  "",
  positionalArgsTable(resolvePmPath("pm pkg get")),
  "",
  "### `bun pm pkg delete`",
  "",
  positionalArgsTable(resolvePmPath("pm pkg delete")),
  "",
  "### `bun install` flag defaults",
  "",
  flagsTable(typedData.commands.install),
  "",
  "### `bun add` flag defaults",
  "",
  flagsTable(typedData.commands.add),
  "",
  "### `bun test` flag defaults",
  "",
  flagsTable(typedData.commands.test),
  "",
  "### `bun build` flag defaults",
  "",
  flagsTable(typedData.commands.build)
);

const matrixContent = output.join("\n");
const csvContent = makeCsv(topLevelRows);

function buildArtifacts(generatedAt: string): {
  dynamicSources: ReturnType<typeof buildDynamicSources>;
  htmlContent: string;
  taxonomyContent: string;
  coverageReport: ReturnType<typeof buildTaxonomyCoverage>;
} {
  const dynamicSources = {
    ...buildDynamicSources(typedData.version, liveBunVersion, jsonHash),
    generatedAt,
  };
  const htmlContent = makeHtmlReport({
    title: "Bun CLI Completion Behavior Matrix",
    bunVersion: liveBunVersion,
    revision: liveBunRevision,
    schema: typedData.version,
    jsonHash,
    generatedAt: dynamicSources.generatedAt,
    topLevelRows,
    pmRows,
    globalFlagCount: typedData.globalFlags.length,
  });
  const coverageReport = buildTaxonomyCoverage(typedData, generatedAt);
  const taxonomyContent = JSON.stringify(coverageReport, null, 2);
  return { dynamicSources, htmlContent, taxonomyContent, coverageReport };
}

async function readExisting(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

async function checkArtifacts(): Promise<{ ok: boolean; messages: string[] }> {
  const existingDynamic = await readExisting(DYNAMIC_SOURCES_PATH);
  const generatedAt = existingDynamic
    ? ((JSON.parse(existingDynamic).generatedAt as string) ?? new Date().toISOString())
    : new Date().toISOString();
  const { dynamicSources, htmlContent, taxonomyContent } = buildArtifacts(generatedAt);
  const dynamicContent = JSON.stringify(dynamicSources, null, 2);

  const checks: { name: string; path: string; actual: string }[] = [
    { name: "Matrix", path: MATRIX_PATH, actual: matrixContent },
    { name: "Dynamic sources", path: DYNAMIC_SOURCES_PATH, actual: dynamicContent },
    { name: "Taxonomy", path: TAXONOMY_PATH, actual: taxonomyContent },
  ];
  if (writeCsv) checks.push({ name: "CSV", path: CSV_PATH, actual: csvContent });
  if (writeHtml) checks.push({ name: "HTML", path: HTML_PATH, actual: htmlContent });

  const messages: string[] = [];
  let ok = true;
  for (const check of checks) {
    const existing = await readExisting(check.path);
    if (existing === null) {
      ok = false;
      messages.push(`❌ ${check.name} missing: ${check.path}`);
    } else if (existing !== check.actual) {
      ok = false;
      messages.push(`❌ ${check.name} out of date: ${check.path}`);
    } else {
      messages.push(`✅ ${check.name} up to date: ${check.path}`);
    }
  }
  return { ok, messages };
}

if (checkMode) {
  const { ok, messages } = await checkArtifacts();
  for (const message of messages) console.log(message);
  console.log(
    `\n${ok ? "✅" : "❌"} Check ${ok ? "passed" : "failed"}: matrix artifacts ${ok ? "are" : "are not"} up to date.`
  );
  process.exit(ok ? 0 : 1);
}

const now = new Date().toISOString();
const { dynamicSources, htmlContent, taxonomyContent, coverageReport } = buildArtifacts(now);
const dynamicContent = JSON.stringify(dynamicSources, null, 2);

if (dryRun) {
  console.log(`🔍 Dry run: would write ${MATRIX_PATH}, ${DYNAMIC_SOURCES_PATH}`);
  console.log(`🔍 Dry run: would write ${TAXONOMY_PATH}`);
  if (writeCsv) console.log(`🔍 Dry run: would write ${CSV_PATH}`);
  if (writeHtml) console.log(`🔍 Dry run: would write ${HTML_PATH}`);
} else {
  // ── Bun-native write ──────────────────────────────────────────
  await Bun.write(MATRIX_PATH, matrixContent);
  console.log(`✅ Wrote ${MATRIX_PATH} (${await Bun.file(MATRIX_PATH).size} bytes)`);

  // ── Bun-native JSON write ─────────────────────────────────────
  await Bun.write(DYNAMIC_SOURCES_PATH, dynamicContent);
  console.log(`✅ Wrote ${DYNAMIC_SOURCES_PATH}`);

  // ── Taxonomy coverage report ──────────────────────────────────
  await Bun.write(TAXONOMY_PATH, taxonomyContent);
  console.log(
    `✅ Wrote ${TAXONOMY_PATH} (${coverageReport.coveragePercent}% coverage, ${coverageReport.uncategorizedFlags} uncategorized)`
  );

  // ── CSV export ────────────────────────────────────────────────
  if (writeCsv) {
    await Bun.write(CSV_PATH, csvContent);
    console.log(`✅ Wrote ${CSV_PATH} (${await Bun.file(CSV_PATH).size} bytes)`);
  }

  // ── HTML report ───────────────────────────────────────────────
  if (writeHtml) {
    await Bun.write(HTML_PATH, htmlContent);
    console.log(`✅ Wrote ${HTML_PATH} (${await Bun.file(HTML_PATH).size} bytes)`);
  }

  // ── Optional: Bun.gzip compressed backup ──────────────────────
  if (Bun.env.BUN_COMPLETION_BACKUP === "1") {
    const backupPath = `${JSON_PATH}.gz`;
    const compressed = Bun.gzipSync(new TextEncoder().encode(rawJson));
    await Bun.write(backupPath, compressed);
    console.log(`📦 Compressed backup: ${backupPath} (${compressed.length} bytes)`);
  }
}

// ── Validation: round-trip sanity check ─────────────────────────
const roundTrip = dryRun ? dynamicSources : JSON.parse(await Bun.file(DYNAMIC_SOURCES_PATH).text());
const expectedKeys = ["schema", "bunVersion", "jsonHash", "generatedAt", "sources"];
const actualSorted = Object.keys(roundTrip).sort();
const expectedSorted = expectedKeys.slice().sort();
if (!Bun.deepEquals(actualSorted, expectedSorted)) {
  console.warn(
    `⚠️ Round-trip keys mismatch: got [${actualSorted.join(", ")}], expected [${expectedSorted.join(", ")}]`
  );
}

// ── Final status via Bun.inspect.table ──────────────────────────
const statusRows: Record<string, string>[] = [
  { Artifact: "Matrix", Path: MATRIX_PATH, Hash: jsonHash },
  { Artifact: "Dynamic sources", Path: DYNAMIC_SOURCES_PATH, Hash: "—" },
  { Artifact: "Taxonomy", Path: TAXONOMY_PATH, Hash: "—" },
  { Artifact: "Bun version", Path: bunPath ?? "—", Hash: liveBunVersion },
  { Artifact: "Bun revision", Path: "—", Hash: liveBunRevision },
];
if (dryRun) statusRows.push({ Artifact: "Mode", Path: "dry-run", Hash: "—" });
if (checkMode) statusRows.push({ Artifact: "Mode", Path: "check", Hash: "—" });
if (writeCsv) statusRows.push({ Artifact: "CSV", Path: CSV_PATH, Hash: "—" });
if (writeHtml) statusRows.push({ Artifact: "HTML", Path: HTML_PATH, Hash: "—" });

console.log("\n" + Bun.inspect.table(statusRows, { colors: true }));
