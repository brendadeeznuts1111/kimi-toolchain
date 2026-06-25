#!/usr/bin/env bun
/**
 * make-completion-matrix.ts
 *
 * Reads completions/bun-cli.json and produces:
 *   - completions/COMPLETION_MATRIX.md   (human-readable flag taxonomy)
 *   - completions/DYNAMIC_SOURCES.json   (machine-readable dynamic completion contract)
 *
 * Run via:
 *   bun run scripts/make-completion-matrix.ts
 *   bun run completions:matrix
 */

import { join } from "path";
import { createHash } from "crypto";
import { readText, writeText } from "../src/lib/bun-io.ts";

interface FlagInfo {
  name: string;
  shortName?: string;
  description: string;
  hasValue: boolean;
  valueType?: string;
  defaultValue?: string;
  choices?: string[];
  required?: boolean;
  multiple?: boolean;
}

interface PositionalArg {
  name: string;
  description?: string;
  required: boolean;
  multiple: boolean;
  type?: string;
  completionType?: string;
}

interface SubcommandInfo {
  name: string;
  description: string;
  flags?: FlagInfo[];
  subcommands?: Record<string, SubcommandInfo>;
  positionalArgs?: PositionalArg[];
}

interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  flags: FlagInfo[];
  positionalArgs: PositionalArg[];
  examples: string[];
  subcommands?: Record<string, SubcommandInfo>;
  documentationUrl?: string;
  docUrl?: string;
  docContent?: string;
  sections?: { title: string; anchor: string; url: string }[];
  dynamicCompletions?: {
    scripts?: boolean;
    packages?: boolean;
    files?: boolean;
    binaries?: boolean;
  };
}

interface CompletionData {
  version: string;
  referenceUrl: string;
  apiModules: { name: string; url: string }[];
  docs: { title: string; url: string; description?: string }[];
  commands: Record<string, CommandInfo>;
  globalFlags: FlagInfo[];
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
  bunGetCompletes: {
    available: boolean;
    commands: {
      scripts: string;
      binaries: string;
      packages: string;
      files: string;
    };
  };
}

const ROOT = import.meta.dir.endsWith("scripts") ? join(import.meta.dir, "..") : import.meta.dir;
const JSON_PATH = join(ROOT, "completions", "bun-cli.json");
const MATRIX_PATH = join(ROOT, "completions", "COMPLETION_MATRIX.md");
const DYNAMIC_SOURCES_PATH = join(ROOT, "completions", "DYNAMIC_SOURCES.json");

const FLAG_CATEGORIES: Record<string, Set<string>> = {
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
    "external",
    "packages",
    "target",
    "sourcemap",
    "minify",
    "splitting",
    "format",
    "env-file",
    "config",
    "cwd",
    "tsconfig-override",
  ]),
  pm: new Set([
    "frozen-lockfile",
    "production",
    "development",
    "dev",
    "optional",
    "peer",
    "no-save",
    "save",
    "global",
    "trust",
    "exact",
    "yarn",
    "no-verify",
    "ignore-scripts",
    "save-text-lockfile",
    "lockfile-only",
    "linker",
    "minimum-release-age",
    "backend",
    "cache-dir",
    "no-cache",
    "omit",
    "registry",
    "force",
    "dry-run",
    "only-missing",
  ]),
  runtime: new Set([
    "watch",
    "hot",
    "preload",
    "require",
    "import",
    "env-file",
    "shell",
    "bun",
    "no-orphans",
    "smol",
    "no-clear-screen",
    "parallel",
    "sequential",
    "no-exit-on-error",
    "workspaces",
    "filter",
  ]),
  debug: new Set([
    "sourcemap",
    "inspect",
    "inspect-wait",
    "inspect-brk",
    "cpu-prof",
    "verbose",
    "silent",
    "quiet",
    "no-progress",
    "no-summary",
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
    "network-concurrency",
    "no-verify",
  ]),
};

function classifyFlag(flagName: string): string[] {
  const categories: string[] = [];
  for (const [cat, flags] of Object.entries(FLAG_CATEGORIES)) {
    if (flags.has(flagName)) categories.push(cat);
  }
  return categories.length ? categories : ["uncategorized"];
}

function countFlagsByCategory(flags: FlagInfo[]): Record<string, number> {
  const counts: Record<string, number> = {
    fileIO: 0,
    pm: 0,
    runtime: 0,
    debug: 0,
    network: 0,
    uncategorized: 0,
  };
  for (const flag of flags) {
    const categories = classifyFlag(flag.name);
    for (const cat of categories) {
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
  }
  return counts;
}

function countSubcommandsRecursively(subcommands?: Record<string, SubcommandInfo>): number {
  if (!subcommands) return 0;
  let count = Object.keys(subcommands).length;
  for (const sub of Object.values(subcommands)) {
    count += countSubcommandsRecursively(sub.subcommands);
  }
  return count;
}

function cleanAliases(aliases?: string[]): string[] {
  const cleaned = (aliases ?? []).filter((a) => a.length > 0 && a !== "bun" && a !== "bunx");
  if (cleaned.some((a) => a === "bun")) {
    throw new Error('Parser leak: "bun" cannot be an alias of itself');
  }
  return cleaned;
}

function dynamicSource(command: CommandInfo): string {
  const sources: string[] = [];
  if (command.dynamicCompletions?.scripts) sources.push("scripts");
  if (command.dynamicCompletions?.packages) sources.push("packages");
  if (command.dynamicCompletions?.files) sources.push("files");
  if (command.dynamicCompletions?.binaries) sources.push("binaries");
  return sources.join(", ") || "—";
}

function sha256Short(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

function generateMatrix(data: CompletionData, jsonHash: string): string {
  const lines: string[] = [
    "# Bun CLI Completion Matrix",
    "",
    `Generated from "completions/bun-cli.json" (sha256: \`${jsonHash}\`).`,
    "",
    "## Command surface",
    "",
    "| Command | Aliases | Flags | Value flags | Defaults | Choices | Positional args | Req pos | Opt pos | File I/O | PM | Runtime | Debug | Network | Subcommands | Dynamic source |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ];

  for (const [name, cmd] of Object.entries(data.commands)) {
    const aliases = cleanAliases(cmd.aliases).join(", ") || "—";
    const valueFlags = cmd.flags.filter((f) => f.hasValue).length;
    const defaults = cmd.flags.filter((f) => f.defaultValue).length;
    const choices = cmd.flags.filter((f) => f.choices && f.choices.length > 0).length;
    const reqPos = cmd.positionalArgs.filter((a) => a.required).length;
    const optPos = cmd.positionalArgs.filter((a) => !a.required).length;
    const cats = countFlagsByCategory(cmd.flags);
    const subcommands = countSubcommandsRecursively(cmd.subcommands);

    lines.push(
      `| ${name} | ${aliases} | ${cmd.flags.length} | ${valueFlags} | ${defaults} | ${choices} | ${cmd.positionalArgs.length} | ${reqPos} | ${optPos} | ${cats.fileIO} | ${cats.pm} | ${cats.runtime} | ${cats.debug} | ${cats.network} | ${subcommands} | ${dynamicSource(cmd)} |`
    );
  }

  lines.push("");
  lines.push("## Global flag inheritance by command");
  lines.push("");
  lines.push("| Command | Inherits global | Own flags | Total surface | Critical inherited |");
  lines.push("|---|---:|---:|---:|---|");

  const globalCount = data.globalFlags.length;
  const criticalGlobal = ["--watch", "--hot", "--env-file", "--preload", "--inspect"];

  for (const [name, cmd] of Object.entries(data.commands)) {
    const inherits = name === "pm" ? 0 : globalCount;
    const own = cmd.flags.length;
    const total = name === "pm" ? own : own + globalCount;
    const inherited = name === "pm" ? "— (pm is isolated)" : criticalGlobal.join(", ");
    lines.push(`| ${name} | ${inherits} | ${own} | ${total} | ${inherited} |`);
  }

  lines.push("");
  lines.push("## Dynamic completion sources");
  lines.push("");
  lines.push("| Source | Provider | Args | Commands |");
  lines.push("|---|---|---|---|");
  lines.push(`| scripts | bun getcompletes | s | run |`);
  lines.push(`| binaries | bun getcompletes | b | run |`);
  lines.push(`| files | bun getcompletes | j | run, test, build |`);
  lines.push(`| installed packages | bun getcompletes | a | remove |`);
  lines.push(`| registry packages | — | — | add |`);
  lines.push("");
  lines.push("## Global flags");
  lines.push("");
  lines.push(`Total: ${data.globalFlags.length}`);
  lines.push("");
  lines.push("| Flag | Short | Has value | Description |");
  lines.push("|---|---|---|---|");
  for (const flag of data.globalFlags) {
    const short = flag.shortName ? `-${flag.shortName}` : "—";
    lines.push(
      `| --${flag.name} | ${short} | ${flag.hasValue ? "yes" : "no"} | ${flag.description} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

function generateDynamicSources(data: CompletionData): Record<string, unknown> {
  const sources: Record<string, Record<string, unknown>> = {};

  sources.bare_bun = {
    completes: ["files", "scripts", "binaries"],
    provider: null,
  };

  for (const [name, cmd] of Object.entries(data.commands)) {
    const completes: string[] = [];
    const providerArgs: string[] = [];

    if (cmd.dynamicCompletions?.scripts) {
      completes.push("scripts");
      providerArgs.push("s");
    }
    if (cmd.dynamicCompletions?.binaries) {
      completes.push("binaries");
      providerArgs.push("b");
    }
    if (cmd.dynamicCompletions?.packages) {
      completes.push(name === "remove" ? "installed_packages" : "registry_packages");
      providerArgs.push("a");
    }
    if (cmd.dynamicCompletions?.files) {
      completes.push("files");
      providerArgs.push("j");
    }

    if (completes.length === 0) continue;

    const entry: Record<string, unknown> = { completes };
    if (providerArgs.length > 0) {
      entry.provider = "getcompletes";
      entry.providerArgs = providerArgs;
    } else {
      entry.provider = null;
    }

    if (name === "create") {
      entry.templateDir = "$BUN_INSTALL/install/create";
    }

    sources[name] = entry;
  }

  return {
    schema: "v1.1.0",
    sources,
  };
}

function main(): void {
  console.log("📊 Reading completions/bun-cli.json...");
  const raw = readText(JSON_PATH);
  const data: CompletionData = JSON.parse(raw);
  const jsonHash = sha256Short(raw);

  console.log("📝 Writing COMPLETION_MATRIX.md...");
  const matrix = generateMatrix(data, jsonHash);
  writeText(MATRIX_PATH, matrix);

  console.log("📝 Writing DYNAMIC_SOURCES.json...");
  const dynamicSources = generateDynamicSources(data);
  writeText(DYNAMIC_SOURCES_PATH, JSON.stringify(dynamicSources, null, 2));

  console.log(`✅ Matrix written to ${MATRIX_PATH}`);
  console.log(`✅ Dynamic sources written to ${DYNAMIC_SOURCES_PATH}`);
  console.log(`   - Commands: ${Object.keys(data.commands).length}`);
  console.log(`   - Global flags: ${data.globalFlags.length}`);
  console.log(`   - JSON drift hash: ${jsonHash}`);
}

if (import.meta.main) {
  main();
}
