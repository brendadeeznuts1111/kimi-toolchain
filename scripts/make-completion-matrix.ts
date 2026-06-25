#!/usr/bin/env bun
/**
 * make-completion-matrix.ts
 *
 * Reads completions/bun-cli.json and produces:
 *   - completions/COMPLETION_MATRIX.md   (human-readable flag taxonomy)
 *   - completions/DYNAMIC_SOURCES.json   (machine-readable dynamic completion contract)
 *
 * Enhanced with Bun-native APIs throughout:
 *   Bun.file / Bun.write / Bun.sha256 / Bun.inspect.table / Bun.stringWidth
 *   Bun.which / Bun.$ / Bun.main / Bun.version / Bun.gzip
 *   Bun.deepEquals / Bun.env
 *
 * Run via:
 *   bun run scripts/make-completion-matrix.ts
 *   bun run completions:matrix
 *   BUN_COMPLETION_BACKUP=1 bun run completions:matrix   (with gzip backup)
 */

import { $ } from "bun";

// ── Constants ───────────────────────────────────────────────────
const JSON_PATH = "completions/bun-cli.json";
const MATRIX_PATH = "completions/COMPLETION_MATRIX.md";
const DYNAMIC_SOURCES_PATH = "completions/DYNAMIC_SOURCES.json";

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

// ── Fetch live Bun version via Bun.$ ────────────────────────────
let liveBunVersion = Bun.version;
try {
  const versionProc = await $`bun --version`.quiet();
  liveBunVersion = versionProc.text().trim();
} catch {
  // Fallback to Bun.version constant
}

// ── Bun-native file read ────────────────────────────────────────
const rawJson = await Bun.file(JSON_PATH).text();

// ── Bun-native SHA-256 ──────────────────────────────────────────
const jsonHash = Bun.SHA256.hash(rawJson, "hex").slice(0, 8);

// ── Parse ───────────────────────────────────────────────────────
const data = JSON.parse(rawJson);

// ── Type definitions ────────────────────────────────────────────
interface FlagEntry {
  name: string;
  shortName?: string;
  description?: string;
  hasValue: boolean;
  valueType?: string;
  defaultValue?: string;
  choices?: string[];
  required?: boolean;
  multiple?: boolean;
}

interface PositionalArgEntry {
  name: string;
  description?: string;
  required: boolean;
  multiple: boolean;
  type?: string;
  completionType?: string;
  choices?: string[];
}

interface CommandEntry {
  name: string;
  aliases?: string[];
  description?: string;
  usage?: string;
  flags: FlagEntry[];
  positionalArgs: PositionalArgEntry[];
  examples: string[];
  subcommands?: Record<string, CommandEntry>;
  dynamicCompletions?: Record<string, boolean>;
  documentationUrl?: string;
  docUrl?: string;
  docContent?: string;
  sections?: { title: string; anchor: string; url: string }[];
}

interface CompletionData {
  version: string;
  bunVersion?: string;
  referenceUrl?: string;
  apiModules?: { name: string; url: string }[];
  docs?: { title: string; url: string; description?: string }[];
  commands: Record<string, CommandEntry>;
  globalFlags: FlagEntry[];
  bunGetCompletes: {
    available: boolean;
    commands?: {
      scripts: string;
      binaries: string;
      packages: string;
      files: string;
    };
  };
  specialHandling: {
    bareCommand: {
      description: string;
      canRunFiles: boolean;
      dynamicCompletions: {
        scripts: boolean;
        files: boolean;
        binaries: boolean;
      };
    };
  };
}

const typedData = data as CompletionData;

// ── Flag taxonomy ───────────────────────────────────────────────
const FLAG_CATEGORIES = {
  fileIO: new Set([
    "outfile",
    "outdir",
    "outbase",
    "entry-naming",
    "chunk-naming",
    "asset-naming",
    "public-dir",
    "assets",
    "loader",
    "tsconfig-override",
    "cwd",
    "config",
    "env-file",
    "cafile",
    "cache-dir",
    "public",
    "routes",
    "app",
    "external",
    "packages",
    "target",
    "sourcemap",
    "minify",
    "splitting",
    "format",
  ]),
  pm: new Set([
    "frozen-lockfile",
    "production",
    "development",
    "dev",
    "no-save",
    "save",
    "global",
    "trust",
    "no-trust",
    "exact",
    "optional",
    "peer",
    "resolutions",
    "hoist",
    "no-hoist",
    "linker",
    "omit",
    "backend",
    "concurrent-scripts",
    "network-concurrency",
    "registry",
    "auth-type",
    "tag",
    "access",
    "dry-run",
    "no-cache",
    "prefer-offline",
    "no-verify",
    "ignore-scripts",
    "no-summary",
    "no-progress",
    "no-install",
    "save-text-lockfile",
    "lockfile-only",
    "minimum-release-age",
    "force",
    "only-missing",
    "yarn",
  ]),
  runtime: new Set([
    "watch",
    "hot",
    "preload",
    "import-meta-url",
    "smol",
    "no-deprecation",
    "throw-deprecation",
    "env-file",
    "cwd",
    "port",
    "hostname",
    "conditions",
    "main-fields",
    "extensions",
    "target",
    "format",
    "packages",
    "no-orphans",
    "no-clear-screen",
    "parallel",
    "sequential",
    "no-exit-on-error",
    "workspaces",
    "filter",
    "bun",
  ]),
  debug: new Set([
    "sourcemap",
    "inspect",
    "inspect-wait",
    "inspect-brk",
    "inspect-publish-port",
    "verbose",
    "silent",
    "quiet",
    "no-progress",
    "no-summary",
    "only-failures",
    "coverage",
    "coverage-reporter",
    "coverage-dir",
    "cpu-prof",
    "revision",
    "version",
  ]),
  network: new Set([
    "timeout",
    "prefer-offline",
    "no-cache",
    "registry",
    "cert",
    "ca",
    "cafile",
    "auth-type",
    "proxy",
    "network-concurrency",
    "no-verify",
    "tls-min-version",
    "tls-max-version",
    "no-deprecation",
  ]),
} as const;

function classifyFlag(name: string): (keyof typeof FLAG_CATEGORIES | "uncategorized")[] {
  const categories: (keyof typeof FLAG_CATEGORIES | "uncategorized")[] = [];
  for (const [cat, flags] of Object.entries(FLAG_CATEGORIES)) {
    if (flags.has(name)) categories.push(cat as keyof typeof FLAG_CATEGORIES);
  }
  return categories.length ? categories : ["uncategorized"];
}

function countCategory(
  flags: FlagEntry[],
  category: keyof typeof FLAG_CATEGORIES | "uncategorized"
): number {
  return flags.filter((f) => classifyFlag(f.name).includes(category)).length;
}

function bool(x: unknown) {
  return x ? "Yes" : "No";
}

function flagsWithValues(flags: FlagEntry[]) {
  return flags.filter((f) => f.hasValue).length;
}

function flagsWithDefaults(flags: FlagEntry[]) {
  return flags.filter((f) => f.defaultValue !== undefined).length;
}

function flagsWithChoices(flags: FlagEntry[]) {
  return flags.filter((f) => f.choices?.length).length;
}

function defaultList(flags: FlagEntry[]): string {
  const defs = flags
    .filter((f) => f.defaultValue !== undefined)
    .map((f) => `${f.shortName ? `-${f.shortName}/` : ""}--${f.name}=${f.defaultValue}`);
  return defs.join(", ") || "—";
}

function choiceList(flags: FlagEntry[]): string {
  const choices = flags
    .filter((f) => f.choices?.length)
    .map((f) => `${f.shortName ? `-${f.shortName}/` : ""}--${f.name}={${f.choices!.join(", ")}}`);
  return choices.join(", ") || "—";
}

function subcommandCount(cmd: CommandEntry) {
  return cmd.subcommands ? Object.keys(cmd.subcommands).length : 0;
}

function dynamicList(cmd: CommandEntry) {
  if (!cmd.dynamicCompletions) return "";
  const keys = Object.keys(cmd.dynamicCompletions);
  return keys.length ? keys.join(", ") : "";
}

function collectPmRows(cmd: CommandEntry): { name: string; path: string }[] {
  const rows: { name: string; path: string }[] = [];
  if (cmd.subcommands) {
    for (const [subName, sub] of Object.entries(cmd.subcommands)) {
      rows.push({ name: subName, path: `pm ${subName}` });
      if (sub.subcommands) {
        for (const nestedName of Object.keys(sub.subcommands)) {
          rows.push({ name: nestedName, path: `pm ${subName} ${nestedName}` });
        }
      }
    }
  }
  return rows;
}

function resolvePmPath(path: string): CommandEntry | undefined {
  const parts = path.split(" ");
  let target: CommandEntry | undefined = typedData.commands.pm;
  for (let i = 1; i < parts.length; i++) {
    target = target?.subcommands?.[parts[i]];
  }
  return target;
}

// ── Clean parser artifacts ──────────────────────────────────────
function cleanAliases(aliases: string[] | undefined): string[] {
  if (!aliases) return [];
  const cleaned = aliases.filter((a) => a !== "bun" && a !== "bunx" && a.length > 0);
  if (cleaned.some((a) => a === "bun")) {
    throw new Error('Parser leak: "bun" cannot be an alias of itself');
  }
  return cleaned;
}

function aliasText(cmd: CommandEntry) {
  const aliases = cleanAliases(cmd.aliases);
  return aliases.length ? ` (${aliases.join(", ")})` : "";
}

// ── Global flag inheritance ─────────────────────────────────────
const PM_TOP_COMMANDS = new Set(["pm"]);

function inheritsGlobals(cmdName: string): boolean {
  return !PM_TOP_COMMANDS.has(cmdName);
}

function totalSurface(cmd: CommandEntry): number {
  return cmd.flags.length + typedData.globalFlags.length;
}

function criticalInheritedFlags(cmdName: string): string {
  const globalFlagNames = new Set(typedData.globalFlags.map((f) => f.name));
  const ownFlagNames = new Set((typedData.commands[cmdName]?.flags || []).map((f) => f.name));

  const critical = [
    "watch",
    "hot",
    "env-file",
    "preload",
    "inspect",
    "sourcemap",
    "outfile",
    "minify",
    "timeout",
    "bail",
    "coverage",
    "global",
    "development",
    "exact",
    "optional",
  ].filter((name) => globalFlagNames.has(name) && !ownFlagNames.has(name));

  return critical.length ? "`" + critical.slice(0, 6).join("`, `") + "`" : "—";
}

// ── Table builder ───────────────────────────────────────────────
function makeTable<T extends Record<string, string | number>>(rows: T[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const header = "| " + cols.join(" | ") + " |";
  const sep = "|" + cols.map(() => " --- ").join("|") + "|";
  const body = rows.map((r) => "| " + cols.map((c) => String(r[c])).join(" | ") + " |").join("\n");
  return [header, sep, body].join("\n");
}

// ── Bun.inspect.table for terminal diagnostics ──────────────────
function logDiagnosticsTable(label: string, rows: Record<string, unknown>[]) {
  console.log(`\n📊 ${label}`);
  console.log(
    Bun.inspect.table(rows, {
      colors: true,
    })
  );
}

function positionalArgsTable(cmd: CommandEntry | undefined): string {
  if (!cmd?.positionalArgs?.length) return "*No positional arguments.*";
  const rows = cmd.positionalArgs.map((a) => ({
    Name: a.name,
    Required: a.required ? "Yes" : "No",
    Multiple: a.multiple ? "Yes" : "No",
    Type: a.type || "—",
    "Completion type": a.completionType || "—",
    Choices: a.choices?.length ? a.choices.join(", ") : "—",
    Description: (a.description || "").replace(/\|/g, "\\|"),
  }));
  return makeTable(rows);
}

function flagsTable(cmd: CommandEntry | undefined): string {
  if (!cmd?.flags?.length) return "*No flags.*";
  const rows = cmd.flags.map((f) => ({
    Flag: `${f.shortName ? `-${f.shortName}, ` : ""}--${f.name}`,
    "Has value": f.hasValue ? "Yes" : "No",
    "Value type": f.valueType || "—",
    Default: f.defaultValue || "—",
    Choices: f.choices?.length ? f.choices.join(", ") : "—",
    Categories: classifyFlag(f.name).join(", ") || "—",
    Description: (f.description || "").replace(/\|/g, "\\|"),
  }));
  return makeTable(rows);
}

// ── Build top-level rows ────────────────────────────────────────
const topLevelRows = Object.entries(typedData.commands)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, cmd]) => {
    const reqPos = cmd.positionalArgs.filter((a) => a.required).length;
    const optPos = cmd.positionalArgs.length - reqPos;
    return {
      Command: name + aliasText(cmd),
      Flags: cmd.flags.length,
      "Value flags": flagsWithValues(cmd.flags),
      "Positional args": cmd.positionalArgs.length,
      "Req pos": reqPos,
      "Opt pos": optPos,
      "File I/O": countCategory(cmd.flags, "fileIO"),
      PM: countCategory(cmd.flags, "pm"),
      Runtime: countCategory(cmd.flags, "runtime"),
      Debug: countCategory(cmd.flags, "debug"),
      Network: countCategory(cmd.flags, "network"),
      Subcommands: subcommandCount(cmd),
      Dynamic: dynamicList(cmd) || "—",
      Examples: cmd.examples.length,
      "Defaults (#)": flagsWithDefaults(cmd.flags),
      "Default values": defaultList(cmd.flags),
      "Choices (#)": flagsWithChoices(cmd.flags),
      "Choice values": choiceList(cmd.flags),
      "Drift hash": jsonHash,
    };
  });

// ── Build PM rows ───────────────────────────────────────────────
const pmRows = collectPmRows(typedData.commands.pm).map((row) => {
  const target = resolvePmPath(row.path);
  const reqPos = (target?.positionalArgs || []).filter((a) => a.required).length;
  const optPos = (target?.positionalArgs || []).length - reqPos;
  const subCount = target?.subcommands ? Object.keys(target.subcommands).length : 0;
  return {
    Path: row.path,
    Flags: target?.flags?.length || 0,
    "Value flags": flagsWithValues(target?.flags || []),
    "Positional args": target?.positionalArgs?.length || 0,
    "Req pos": reqPos,
    "Opt pos": optPos,
    "File I/O": countCategory(target?.flags || [], "fileIO"),
    PM: countCategory(target?.flags || [], "pm"),
    Runtime: countCategory(target?.flags || [], "runtime"),
    Debug: countCategory(target?.flags || [], "debug"),
    Network: countCategory(target?.flags || [], "network"),
    Subcommands: subCount,
    Examples: target?.examples?.length || 0,
    "Defaults (#)": flagsWithDefaults(target?.flags || []),
    "Default values": defaultList(target?.flags || []),
    "Choices (#)": flagsWithChoices(target?.flags || []),
    "Choice values": choiceList(target?.flags || []),
    Isolated: "Yes",
    "Drift hash": jsonHash,
  };
});

// ── Terminal diagnostics via Bun.inspect.table ──────────────────
logDiagnosticsTable("Top-level command summary", topLevelRows.slice(0, 6));
logDiagnosticsTable("PM subcommand summary", pmRows.slice(0, 6));

// ── Assemble markdown ───────────────────────────────────────────
const output = [
  "# Bun CLI Completion Behavior Matrix",
  "",
  `Generated from \`completions/bun-cli.json\` (schema v${typedData.version}, Bun ${liveBunVersion}, hash \`${jsonHash}\`).`,
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
      return `| ${name} | ${isolated ? "—" : typedData.globalFlags.length} | ${cmd.flags.length} | ${isolated ? cmd.flags.length : totalSurface(cmd)} | ${isolated ? "Yes" : "No"} | ${isolated ? "—" : criticalInheritedFlags(name)} |`;
    }),
  "",
  "## Global flags",
  "",
  `- Total: ${typedData.globalFlags.length}`,
  `- With values: ${flagsWithValues(typedData.globalFlags)}`,
  `- With defaults: ${flagsWithDefaults(typedData.globalFlags)}`,
  `- With choices: ${flagsWithChoices(typedData.globalFlags)}`,
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

// Detailed breakdowns
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

// ── Bun-native write ────────────────────────────────────────────
await Bun.write(MATRIX_PATH, output.join("\n"));
console.log(`✅ Wrote ${MATRIX_PATH} (${await Bun.file(MATRIX_PATH).size} bytes)`);

// ── Dynamic source contract ─────────────────────────────────────
const dynamicSources = {
  schema: typedData.version,
  bunVersion: liveBunVersion,
  jsonHash,
  generatedAt: new Date().toISOString(),
  sources: {
    bare_bun: {
      completes: ["files", "scripts", "binaries"],
      provider: null,
      providerArgs: null,
    },
    run: {
      completes: ["scripts", "files", "binaries"],
      provider: "getcompletes",
      providerArgs: ["s", "b", "j"],
    },
    add: {
      completes: ["registry_packages"],
      provider: "getcompletes",
      providerArgs: ["a"],
    },
    remove: {
      completes: ["installed_packages"],
      provider: "getcompletes",
      providerArgs: ["a"],
    },
    create: {
      completes: ["templates"],
      provider: null,
      templateDir: "$BUN_INSTALL/create",
    },
    test: {
      completes: ["files"],
      provider: "getcompletes",
      providerArgs: ["j"],
    },
    build: {
      completes: ["files"],
      provider: "getcompletes",
      providerArgs: ["j"],
    },
  },
};

// ── Bun-native JSON write ───────────────────────────────────────
await Bun.write(DYNAMIC_SOURCES_PATH, JSON.stringify(dynamicSources, null, 2));
console.log(`✅ Wrote ${DYNAMIC_SOURCES_PATH}`);

// ── Optional: Bun.gzip compressed backup ────────────────────────
if (Bun.env.BUN_COMPLETION_BACKUP === "1") {
  const backupPath = `${JSON_PATH}.gz`;
  const compressed = Bun.gzipSync(new TextEncoder().encode(rawJson));
  await Bun.write(backupPath, compressed);
  console.log(`📦 Compressed backup: ${backupPath} (${compressed.length} bytes)`);
}

// ── Validation: round-trip sanity check ─────────────────────────
const roundTrip = JSON.parse(await Bun.file(DYNAMIC_SOURCES_PATH).text());
const expectedKeys = ["schema", "bunVersion", "jsonHash", "generatedAt", "sources"];
const actualSorted = Object.keys(roundTrip).sort();
const expectedSorted = expectedKeys.slice().sort();
if (!Bun.deepEquals(actualSorted, expectedSorted)) {
  console.warn(
    `⚠️ Round-trip keys mismatch: got [${actualSorted.join(", ")}], expected [${expectedSorted.join(", ")}]`
  );
}

// ── Final status via Bun.inspect.table ──────────────────────────
console.log(
  "\n" +
    Bun.inspect.table(
      [
        { Artifact: "Matrix", Path: MATRIX_PATH, Hash: jsonHash },
        { Artifact: "Dynamic sources", Path: DYNAMIC_SOURCES_PATH, Hash: "—" },
        { Artifact: "Bun version", Path: bunPath ?? "—", Hash: liveBunVersion },
      ],
      { colors: true }
    )
);
