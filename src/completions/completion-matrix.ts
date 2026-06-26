/**
 * Completion matrix pure functions and types.
 *
 * Shared between scripts/make-completion-matrix.ts and the snapshot test suite.
 */

import { classifyFlag, type FlagCategory } from "./flag-taxonomy.ts";

// ── Type definitions ────────────────────────────────────────────
export interface FlagEntry {
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

export interface PositionalArgEntry {
  name: string;
  description?: string;
  required: boolean;
  multiple: boolean;
  type?: string;
  completionType?: string;
  choices?: string[];
}

export interface CommandEntry {
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

export interface CompletionData {
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

export interface DynamicSources {
  schema: string;
  bunVersion: string;
  jsonHash: string;
  generatedAt: string;
  sources: Record<string, unknown>;
}

// Re-export taxonomy symbols for consumers that only import completion-matrix.
export { FLAG_CATEGORIES, classifyFlag, classifyFlagForCommand } from "./flag-taxonomy.ts";
export type { FlagCategory } from "./flag-taxonomy.ts";

export function countCategory(flags: FlagEntry[], category: FlagCategory): number {
  return flags.filter((f) => classifyFlag(f.name).includes(category)).length;
}

export function bool(x: unknown): string {
  return x ? "Yes" : "No";
}

export function flagsWithValues(flags: FlagEntry[]): number {
  return flags.filter((f) => f.hasValue).length;
}

export function flagsWithDefaults(flags: FlagEntry[]): number {
  return flags.filter((f) => f.defaultValue !== undefined).length;
}

export function flagsWithChoices(flags: FlagEntry[]): number {
  return flags.filter((f) => f.choices?.length).length;
}

export function defaultList(flags: FlagEntry[]): string {
  const defs = flags
    .filter((f) => f.defaultValue !== undefined)
    .map((f) => `${f.shortName ? `-${f.shortName}/` : ""}--${f.name}=${f.defaultValue}`);
  return defs.join(", ") || "—";
}

export function choiceList(flags: FlagEntry[]): string {
  const choices = flags
    .filter((f) => f.choices?.length)
    .map((f) => `${f.shortName ? `-${f.shortName}/` : ""}--${f.name}={${f.choices!.join(", ")}}`);
  return choices.join(", ") || "—";
}

export function subcommandCount(cmd: CommandEntry): number {
  return cmd.subcommands ? Object.keys(cmd.subcommands).length : 0;
}

export function dynamicList(cmd: CommandEntry): string {
  if (!cmd.dynamicCompletions) return "";
  const keys = Object.keys(cmd.dynamicCompletions);
  return keys.length ? keys.join(", ") : "";
}

export function collectPmRows(cmd: CommandEntry): { name: string; path: string }[] {
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

export function cleanAliases(aliases: string[] | undefined): string[] {
  if (!aliases) return [];
  if (aliases.includes("bun")) {
    throw new Error('Parser leak: "bun" cannot be an alias of itself');
  }
  return aliases.filter((a) => a !== "bunx" && a.length > 0);
}

export function aliasText(cmd: CommandEntry): string {
  const aliases = cleanAliases(cmd.aliases);
  return aliases.length ? ` (${aliases.join(", ")})` : "";
}

const PM_TOP_COMMANDS = new Set(["pm"]);

export function inheritsGlobals(cmdName: string): boolean {
  return !PM_TOP_COMMANDS.has(cmdName);
}

export function totalSurface(cmd: CommandEntry, globalFlagCount: number): number {
  return cmd.flags.length + globalFlagCount;
}

export function criticalInheritedFlags(
  cmdName: string,
  globalFlags: FlagEntry[],
  commands: Record<string, CommandEntry>
): string {
  const globalFlagNames = new Set(globalFlags.map((f) => f.name));
  const ownFlagNames = new Set((commands[cmdName]?.flags || []).map((f) => f.name));

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

export function makeTable<T extends Record<string, string | number>>(rows: T[]): string {
  if (rows.length === 0) return "";
  const first = rows[0];
  if (!first) return "";
  const cols = Object.keys(first);
  const cell = (v: string | number): string => String(v).replace(/\|/g, "\\|");
  const header = "| " + cols.join(" | ") + " |";
  const sep = "|" + cols.map(() => " --- ").join("|") + "|";
  const body = rows.map((r) => "| " + cols.map((c) => cell(r[c] ?? "")).join(" | ") + " |").join("\n");
  return [header, sep, body].join("\n");
}

export function positionalArgsTable(cmd: CommandEntry | undefined): string {
  if (!cmd?.positionalArgs?.length) return "*No positional arguments.*";
  const rows = cmd.positionalArgs.map((a) => ({
    Name: a.name,
    Required: a.required ? "Yes" : "No",
    Multiple: a.multiple ? "Yes" : "No",
    Type: a.type || "—",
    "Completion type": a.completionType || "—",
    Choices: a.choices?.length ? a.choices.join(", ") : "—",
    Description: a.description || "",
  }));
  return makeTable(rows);
}

export function flagsTable(cmd: CommandEntry | undefined): string {
  if (!cmd?.flags?.length) return "*No flags.*";
  const rows = cmd.flags.map((f) => ({
    Flag: `${f.shortName ? `-${f.shortName}, ` : ""}--${f.name}`,
    "Has value": f.hasValue ? "Yes" : "No",
    "Value type": f.valueType || "—",
    Default: f.defaultValue || "—",
    Choices: f.choices?.length ? f.choices.join(", ") : "—",
    Categories: classifyFlag(f.name).join(", ") || "—",
    Description: f.description || "",
  }));
  return makeTable(rows);
}

export function buildTopLevelRows(
  commands: Record<string, CommandEntry>,
  jsonHash: string
): Record<string, string | number>[] {
  return Object.entries(commands)
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
        OS: countCategory(cmd.flags, "os"),
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
}

export function buildPmRows(
  pmCommand: CommandEntry | undefined,
  jsonHash: string
): Record<string, string | number>[] {
  if (!pmCommand) return [];
  return collectPmRows(pmCommand).map((row) => {
    const parts = row.path.split(" ");
    let target: CommandEntry | undefined = pmCommand;
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (!part) return row;
      target = target?.subcommands?.[part];
    }
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
      OS: countCategory(target?.flags || [], "os"),
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
}

export function buildDynamicSources(
  schema: string,
  bunVersion: string,
  jsonHash: string
): DynamicSources {
  return {
    schema,
    bunVersion,
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
}

// ── Export helpers ──────────────────────────────────────────────

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function makeCsv(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return "";
  const first = rows[0];
  if (!first) return "";
  const cols = Object.keys(first);
  const header = cols.map(csvCell).join(",");
  const body = rows.map((r) => cols.map((c) => csvCell(r[c] ?? "")).join(","));
  return [header, ...body].join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function makeHtmlReport(options: {
  title: string;
  bunVersion: string;
  revision: string;
  schema: string;
  jsonHash: string;
  generatedAt: string;
  topLevelRows: Record<string, string | number>[];
  pmRows: Record<string, string | number>[];
  globalFlagCount: number;
}): string {
  const css = `<style>
:root { --bg: #0b1120; --surface: #151e32; --elevated: #1e293b; --text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8; --border: #334155; }
* { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 2rem; line-height: 1.5; }
header { max-width: 1200px; margin: 0 auto 2rem; }
h1 { margin: 0 0 0.5rem; font-size: 1.75rem; }
.meta { color: var(--muted); font-size: 0.9rem; margin-bottom: 1.5rem; }
.meta code { background: var(--elevated); padding: 0.15rem 0.4rem; border-radius: 0.25rem; color: var(--accent); }
nav { max-width: 1200px; margin: 0 auto 2rem; padding: 1rem; background: var(--surface); border-radius: 0.5rem; }
nav ul { list-style: none; margin: 0; padding: 0; display: flex; gap: 1rem; flex-wrap: wrap; }
nav a { color: var(--accent); text-decoration: none; }
nav a:hover { text-decoration: underline; }
main { max-width: 1200px; margin: 0 auto; }
section { margin-bottom: 3rem; }
h2 { margin-top: 0; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border); }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
.card { background: var(--surface); padding: 1rem; border-radius: 0.5rem; text-align: center; }
.card .value { font-size: 1.75rem; font-weight: 700; color: var(--accent); }
.card .label { color: var(--muted); font-size: 0.85rem; margin-top: 0.25rem; }
table { border-collapse: collapse; width: 100%; background: var(--surface); border-radius: 0.5rem; overflow: hidden; margin-bottom: 1rem; font-size: 0.9rem; }
th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
th { background: var(--elevated); font-weight: 600; position: sticky; top: 0; }
tr:hover { background: rgba(255,255,255,0.03); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.empty { color: var(--muted); font-style: italic; }
footer { max-width: 1200px; margin: 2rem auto 0; color: var(--muted); font-size: 0.85rem; text-align: center; }
</style>`;

  const renderTable = (rows: Record<string, string | number>[], id?: string) => {
    if (rows.length === 0) return '<p class="empty">No data.</p>';
    const first = rows[0];
    if (!first) return '<p class="empty">No data.</p>';
    const cols = Object.keys(first);
    return `<table${id ? ` id="${id}"` : ""}>
  <thead>
    <tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>
  </thead>
  <tbody>
${rows
  .map(
    (r) =>
      `    <tr>${cols.map((c) => `<td${typeof r[c] === "number" ? ' class="num"' : ""}>${escapeHtml(String(r[c]))}</td>`).join("")}</tr>`
  )
  .join("\n")}
  </tbody>
</table>`;
  };

  const topLevelCount = options.topLevelRows.length;
  const pmCount = options.pmRows.length;
  const commandCount = topLevelCount + pmCount;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)}</title>
  ${css}
</head>
<body>
  <header>
    <h1>${escapeHtml(options.title)}</h1>
    <p class="meta">
      Schema <code>v${escapeHtml(options.schema)}</code> ·
      Bun <code>${escapeHtml(options.bunVersion)}</code> ·
      revision <code>${escapeHtml(options.revision)}</code> ·
      hash <code>${escapeHtml(options.jsonHash)}</code> ·
      ${escapeHtml(options.generatedAt)}
    </p>
  </header>
  <nav>
    <ul>
      <li><a href="#summary">Summary</a></li>
      <li><a href="#top-level">Top-level commands</a></li>
      <li><a href="#pm"><code>bun pm</code> subcommands</a></li>
    </ul>
  </nav>
  <main>
    <section id="summary">
      <h2>Summary</h2>
      <div class="summary">
        <div class="card"><div class="value">${commandCount}</div><div class="label">commands</div></div>
        <div class="card"><div class="value">${topLevelCount}</div><div class="label">top-level</div></div>
        <div class="card"><div class="value">${pmCount}</div><div class="label">pm subcommands</div></div>
        <div class="card"><div class="value">${options.globalFlagCount}</div><div class="label">global flags</div></div>
      </div>
    </section>
    <section id="top-level">
      <h2>Top-level commands</h2>
      ${renderTable(options.topLevelRows, "top-level-table")}
    </section>
    <section id="pm">
      <h2><code>bun pm</code> subcommands</h2>
      ${renderTable(options.pmRows, "pm-table")}
    </section>
  </main>
  <footer>
    Generated by <code>scripts/make-completion-matrix.ts</code> ·
    <a href="https://bun.sh">Bun</a>
  </footer>
</body>
</html>`;
}
