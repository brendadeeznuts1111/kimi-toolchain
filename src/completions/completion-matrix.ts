/**
 * Completion matrix pure functions and types.
 *
 * Shared between scripts/make-completion-matrix.ts and the snapshot test suite.
 */

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

// ── Flag taxonomy ───────────────────────────────────────────────
export const FLAG_CATEGORIES = {
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

export function classifyFlag(name: string): (keyof typeof FLAG_CATEGORIES | "uncategorized")[] {
  const categories: (keyof typeof FLAG_CATEGORIES | "uncategorized")[] = [];
  for (const [cat, flags] of Object.entries(FLAG_CATEGORIES)) {
    if (flags.has(name)) categories.push(cat as keyof typeof FLAG_CATEGORIES);
  }
  return categories.length ? categories : ["uncategorized"];
}

export function countCategory(
  flags: FlagEntry[],
  category: keyof typeof FLAG_CATEGORIES | "uncategorized"
): number {
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
  const cols = Object.keys(rows[0]);
  const cell = (v: string | number): string => String(v).replace(/\|/g, "\\|");
  const header = "| " + cols.join(" | ") + " |";
  const sep = "|" + cols.map(() => " --- ").join("|") + "|";
  const body = rows.map((r) => "| " + cols.map((c) => cell(r[c])).join(" | ") + " |").join("\n");
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
      target = target?.subcommands?.[parts[i]];
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
