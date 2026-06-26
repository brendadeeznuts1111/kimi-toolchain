#!/usr/bin/env bun
/**
 * CLI Flag Parser for Bun Commands
 *
 * This script reads the --help menu for every Bun command and generates JSON
 * containing all flag information, descriptions, and whether they support
 * positional or non-positional arguments.
 *
 * Handles complex cases like:
 * - Nested subcommands (bun pm cache rm)
 * - Command aliases (bun i = bun install, bun a = bun add)
 * - Dynamic completions (scripts, packages, files)
 * - Context-aware flags
 * - Special cases like bare 'bun' vs 'bun run'
 *
 * Output is saved to completions/bun-cli.json for use in generating
 * shell completions (fish, bash, zsh).
 *
 * Based on the upstream Bun generator:
 *   https://github.com/oven-sh/bun/blob/0bf0d8420e21c702bc2ba643ada5379bcaaa08b6/misctools/generate-cli-completions.ts
 *
 * Cleanup / spawn conventions mirror the Bun repo harness:
 *   - temp dir via Symbol.dispose + `using`
 *   - bunExe() resolves process.execPath
 *   - bunEnv strips debug noise
 *   - Bun.spawnSync for one-off --help probes
 */

import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

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

interface SubcommandInfo {
  name: string;
  description: string;
  flags?: FlagInfo[];
  subcommands?: Record<string, SubcommandInfo>;
  positionalArgs?: {
    name: string;
    description?: string;
    required: boolean;
    multiple: boolean;
    type?: string;
    completionType?: string;
  }[];
  examples?: string[];
}

interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  flags: FlagInfo[];
  positionalArgs: {
    name: string;
    description?: string;
    required: boolean;
    multiple: boolean;
    type?: string;
    completionType?: string;
  }[];
  examples: string[];
  subcommands?: Record<string, SubcommandInfo>;
  documentationUrl?: string;
  docUrl?: string;
  docContent?: string;
  sections?: DocSectionInfo[];
  dynamicCompletions?: {
    scripts?: boolean;
    packages?: boolean;
    files?: boolean;
    binaries?: boolean;
  };
}

interface ApiModuleInfo {
  name: string;
  url: string;
}

interface DocPageInfo {
  title: string;
  url: string;
  description?: string;
}

interface DocSectionInfo {
  title: string;
  anchor: string;
  url: string;
}

interface RuntimeApiInfo {
  topic: string;
  apis: string[];
}

interface CompletionData {
  version: string;
  referenceUrl: string;
  apiModules: ApiModuleInfo[];
  docs: DocPageInfo[];
  runtimeApis: RuntimeApiInfo[];
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
      scripts: string; // "bun getcompletes s" or "bun getcompletes z"
      binaries: string; // "bun getcompletes b"
      packages: string; // "bun getcompletes a <prefix>"
      files: string; // "bun getcompletes j"
    };
  };
}

/** Resolve the Bun executable. Prefer explicit override, then PATH lookup. */
function bunExe(): string {
  return Bun.env.BUN_DEBUG_BUILD || Bun.which("bun") || "bun";
}

/** Strip debug noise so --help output is stable (Bun repo harness style). */
function bunEnv(): NodeJS.ProcessEnv {
  const base = { ...Bun.env };
  for (const key of Object.keys(base)) {
    if (key.startsWith("BUN_DEBUG_") && key !== "BUN_DEBUG_QUIET_LOGS") {
      delete base[key];
    }
  }
  base.BUN_DEBUG_QUIET_LOGS = "1";
  base.NO_COLOR = "1";
  base.FORCE_COLOR = undefined;
  base.GITHUB_ACTIONS = "false";
  delete base.BUN_INSPECT_CONNECT_TO;
  delete base.NODE_ENV;
  return base;
}

/** Temp directory that cleans itself up via Symbol.dispose / `using`. */
class TempDir extends String {
  constructor(public readonly path: string) {
    super(path);
  }

  [Symbol.dispose](): void {
    removePath(this.path, { recursive: true, force: true });
  }
}

function createTempDir(basename: string): TempDir {
  const base = `${Bun.env.TMPDIR || "/tmp"}/${basename}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  makeDir(base, { recursive: true });
  return new TempDir(base);
}

const UNMATCHED_WARNINGS: string[] = [];

/**
 * Fetch API module list from https://bun.com/reference.
 * Returns empty array on network/parsing failure so the generator stays offline-safe.
 */
async function fetchBunReferenceModules(): Promise<ApiModuleInfo[]> {
  try {
    const response = await fetch("https://bun.com/reference");
    if (!response.ok) {
      console.warn(`⚠ Failed to fetch Bun reference: HTTP ${response.status}`);
      return [];
    }

    const html = await response.text();
    const seen = new Set<string>();
    const modules: ApiModuleInfo[] = [];

    for (const match of html.matchAll(/href="(\/reference\/[^"]+)"/g)) {
      const path = match[1];
      if (seen.has(path)) continue;
      seen.add(path);

      const name = path.replace(/^\/reference\//, "");
      modules.push({
        name,
        url: `https://bun.com${path}`,
      });
    }

    return modules.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.warn(
      "⚠ Could not fetch Bun reference modules:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

/**
 * Fetch the Bun docs index from https://bun.com/docs/llms.txt.
 * Parses Markdown list items in the format `- [Title](url): description`.
 */
async function fetchBunDocsIndex(): Promise<DocPageInfo[]> {
  try {
    const response = await fetch("https://bun.com/docs/llms.txt");
    if (!response.ok) {
      console.warn(`⚠ Failed to fetch Bun docs index: HTTP ${response.status}`);
      return [];
    }

    const text = await response.text();
    const pages: DocPageInfo[] = [];
    const seen = new Set<string>();

    for (const match of text.matchAll(/^-\s*\[([^\]]+)\]\(([^)]+)\)(?::\s*(.+))?$/gm)) {
      const title = match[1].trim();
      const url = match[2].trim();
      const description = match[3]?.trim();

      if (seen.has(url)) continue;
      seen.add(url);

      pages.push({
        title,
        url: url.startsWith("http") ? url : `https://bun.com${url}`,
        description,
      });
    }

    return pages;
  } catch (error) {
    console.warn(
      "⚠ Could not fetch Bun docs index:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

/**
 * Fetch and parse the Bun runtime APIs overview page.
 * Extracts the topic/API table into a structured list.
 */
async function fetchRuntimeApis(): Promise<RuntimeApiInfo[]> {
  try {
    const response = await fetch("https://bun.com/docs/runtime/bun-apis.md");
    if (!response.ok) {
      console.warn(`⚠ Failed to fetch Bun APIs page: HTTP ${response.status}`);
      return [];
    }

    const markdown = await response.text();
    const apis: RuntimeApiInfo[] = [];
    const seen = new Set<string>();

    // Match table rows like: | HTTP Server | [`Bun.serve`](/runtime/http/server) |
    for (const match of markdown.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)) {
      const topic = match[1].trim();
      const apiCell = match[2].trim();

      if (!topic || topic === "Topic" || seen.has(topic)) continue;
      seen.add(topic);

      // Extract API names: Bun.serve, $, Bun.build, etc.
      const apiNames: string[] = [];
      for (const apiMatch of apiCell.matchAll(/`([^`]+)`/g)) {
        const name = apiMatch[1].trim();
        if (name && !apiNames.includes(name)) apiNames.push(name);
      }

      if (apiNames.length > 0) {
        apis.push({ topic, apis: apiNames });
      }
    }

    return apis;
  } catch (error) {
    console.warn(
      "⚠ Could not fetch Bun runtime APIs:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

/**
 * Parse Markdown headings from a command doc page into section links.
 * Headings become URL anchors (GitHub-style slugification).
 */
function parseDocSections(markdown: string, pageUrl: string): DocSectionInfo[] {
  const sections: DocSectionInfo[] = [];
  const seen = new Set<string>();

  for (const match of markdown.matchAll(/^(#{2,4})\s+(.+)$/gm)) {
    const rawTitle = match[2]
      .replace(/<[^>]+>/g, "")
      .replace(/[`_*]/g, "")
      .trim();
    if (!rawTitle) continue;

    const anchor = rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!anchor || seen.has(anchor)) continue;
    seen.add(anchor);
    sections.push({ title: rawTitle, anchor, url: `${pageUrl}#${anchor}` });
  }

  return sections;
}

/**
 * Parse flag line from help output
 */
function parseFlag(line: string): FlagInfo | null {
  // Match patterns like:
  // -h, --help                          Display this menu and exit
  // --timeout=<val>              Set the per-test timeout in milliseconds, default is 5000.
  // -r, --preload=<val>                 Import a module before other modules are loaded
  // --watch                         Automatically restart the process on file change

  const patterns = [
    // Long flag with short flag and value: -r, --preload=<val>
    /^\s*(-[a-zA-Z]),\s+(--[a-zA-Z0-9-]+)=(<[^>]+>)\s+(.+)$/,
    // Long flag with short flag: -h, --help
    /^\s*(-[a-zA-Z]),\s+(--[a-zA-Z0-9-]+)\s+(.+)$/,
    // Long flag with value: --timeout=<val>
    /^\s+(--[a-zA-Z0-9-]+)=(<[^>]+>)\s+(.+)$/,
    // Long flag with bare value: --react=tailwind
    /^\s+(--[a-zA-Z0-9-]+)=([^\s]+)\s+(.+)$/,
    // Long flag without value: --watch
    /^\s+(--[a-zA-Z0-9-]+)\s+(.+)$/,
    // Short flag only: -i
    /^\s+(-[a-zA-Z])\s+(.+)$/,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      let shortName: string | undefined;
      let longName: string;
      let valueSpec: string | undefined;
      let description: string;

      if (match.length === 5) {
        // Pattern with short flag, long flag, and value
        [, shortName, longName, valueSpec, description] = match;
      } else if (match.length === 4) {
        if (match[1].startsWith("-") && match[1].length === 2) {
          // Short flag with long flag
          [, shortName, longName, description] = match;
        } else if (match[2].startsWith("<")) {
          // Long flag with value
          [, longName, valueSpec, description] = match;
        } else {
          // Long flag without value
          [, longName, description] = match;
        }
      } else if (match.length === 3) {
        if (match[1].length === 2) {
          // Short flag only
          [, shortName, description] = match;
          longName = shortName.replace("-", "--");
        } else {
          // Long flag without value
          [, longName, description] = match;
        }
      } else {
        continue;
      }

      // Extract additional info from description
      const hasValue = !!valueSpec;
      let valueType: string | undefined;
      let defaultValue: string | undefined;
      let choices: string[] | undefined;

      if (valueSpec) {
        valueType = valueSpec.replace(/[<>]/g, "");
      }

      // Look for default values in description
      const defaultMatch = description.match(/[Dd]efault(?:s?)\s*(?:is|to|:)\s*"?([^".\s,]+)"?/);
      if (defaultMatch) {
        defaultValue = defaultMatch[1];
      }

      // Look for choices/enums
      const choicesMatch = description.match(
        /(?:One of|Valid (?:orders?|values?|options?)):?\s*"?([^"]+)"?/
      );
      if (choicesMatch) {
        choices = choicesMatch[1]
          .split(/[,\s]+/)
          .map((s) => s.replace(/[",]/g, "").trim())
          .filter(Boolean);
      }

      return {
        name: longName.replace(/^--/, ""),
        shortName: shortName?.replace(/^-/, ""),
        description: description.trim(),
        hasValue,
        valueType,
        defaultValue,
        choices,
        required: false, // We'll determine this from usage patterns
        multiple: description.toLowerCase().includes("multiple") || description.includes("[]"),
      };
    }
  }

  return null;
}

/**
 * Parse usage line to extract positional arguments
 */
function parseUsage(usage: string): {
  name: string;
  description?: string;
  required: boolean;
  multiple: boolean;
  type?: string;
  completionType?: string;
}[] {
  const args: {
    name: string;
    description?: string;
    required: boolean;
    multiple: boolean;
    type?: string;
    completionType?: string;
  }[] = [];

  // Extract parts after command name
  const parts = usage.split(/\s+/).slice(2); // Skip "Usage:" and command name

  for (const part of parts) {
    if (part.startsWith("[") || part.startsWith("<") || part.includes("...")) {
      let name = part;
      let required = false;
      let multiple = false;
      let completionType: string | undefined;

      // Clean up the argument name
      name = name.replace(/[[\]<>]/g, "");

      if (part.startsWith("<")) {
        required = true;
      }

      if (part.includes("...") || name.includes("...")) {
        multiple = true;
        name = name.replace(/\.{3}/g, "");
      }

      // Skip flags
      if (!name.startsWith("-") && name.length > 0) {
        // Determine completion type based on argument name
        if (name.toLowerCase().includes("package")) {
          completionType = "package";
        } else if (name.toLowerCase().includes("script")) {
          completionType = "script";
        } else if (name.toLowerCase().includes("file") || name.includes(".")) {
          completionType = "file";
        }

        args.push({
          name,
          required,
          multiple,
          type: "string", // Default type
          completionType,
        });
      }
    }
  }

  return args;
}

/**
 * Execute bun command and get help output using Bun.spawnSync.
 * Drain stdout/stderr before checking exit code for useful diagnostics.
 */
function getHelpOutput(command: string[], cwd: string): string {
  try {
    const result = Bun.spawnSync({
      cmd: [bunExe(), ...command, "--help"],
      stdout: "pipe",
      stderr: "pipe",
      cwd,
      env: bunEnv(),
    });

    const stdout = result.stdout?.toString("utf8") ?? "";
    const stderr = result.stderr?.toString("utf8") ?? "";

    if (result.exitCode !== 0) {
      console.warn(`bun ${command.join(" ")} --help exited ${result.exitCode}: ${stderr.trim()}`);
    }

    return stdout || stderr || "";
  } catch (error) {
    console.error(`Failed to get help for command: ${command.join(" ")}`, error);
    return "";
  }
}

/**
 * Parse PM subcommands from help output
 */
function parsePmSubcommands(helpText: string): Record<string, SubcommandInfo> {
  const lines = helpText.split("\n");
  const subcommands: Record<string, SubcommandInfo> = {};

  let inCommands = false;
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "Commands:") {
      inCommands = true;
      continue;
    }

    if (inCommands && trimmed.startsWith("Learn more")) {
      break;
    }

    if (inCommands && line.match(/^\s+bun pm \w+/)) {
      // Parse lines like: "bun pm pack                 create a tarball of the current workspace"
      const match = line.match(/^\s+bun pm (\S+)(?:\s+(.+))?$/);
      if (match) {
        const [, name, description = ""] = match;
        subcommands[name] = {
          name,
          description: description.trim(),
          flags: [],
          positionalArgs: [],
        };

        // Special handling for subcommands with their own subcommands
        if (name === "cache") {
          subcommands[name].subcommands = {
            rm: {
              name: "rm",
              description: "clear the cache",
            },
          };
        } else if (name === "pkg") {
          subcommands[name].subcommands = {
            get: { name: "get", description: "get values from package.json" },
            set: { name: "set", description: "set values in package.json" },
            delete: { name: "delete", description: "delete keys from package.json" },
            fix: { name: "fix", description: "auto-correct common package.json errors" },
          };
        }
      }
    }
  }

  return subcommands;
}

/**
 * Parse help output into CommandInfo
 */
function parseHelpOutput(helpText: string, commandName: string): CommandInfo {
  const lines = helpText.split("\n");
  const command: CommandInfo = {
    name: commandName,
    description: "",
    flags: [],
    positionalArgs: [],
    examples: [],
  };

  let currentSection = "";
  let inFlags = false;
  let inExamples = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Extract command description (usually the first non-usage, non-section line)
    if (
      !command.description &&
      trimmed &&
      !trimmed.startsWith("Usage:") &&
      !trimmed.startsWith("Alias:") &&
      trimmed !== "Flags:" &&
      trimmed !== "Examples:" &&
      trimmed !== "Commands:" &&
      currentSection === ""
    ) {
      command.description = trimmed;
      continue;
    }

    // Extract aliases
    if (trimmed.startsWith("Alias:")) {
      const aliasMatch = trimmed.match(/Alias:\s*(.+)/);
      if (aliasMatch) {
        command.aliases = aliasMatch[1]
          .split(/[,\s]+/)
          .map((a) => a.trim())
          .filter(Boolean);
      }
      continue;
    }

    // Extract usage and positional args
    if (trimmed.startsWith("Usage:")) {
      command.usage = trimmed;
      command.positionalArgs = parseUsage(trimmed);
      continue;
    }

    // Track sections
    if (trimmed === "Flags:") {
      inFlags = true;
      currentSection = "flags";
      continue;
    } else if (trimmed === "Examples:") {
      inExamples = true;
      inFlags = false;
      currentSection = "examples";
      continue;
    } else if (
      trimmed.startsWith("Full documentation") ||
      trimmed.startsWith("Learn more") ||
      trimmed.startsWith("A full list")
    ) {
      const urlMatch = trimmed.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        command.documentationUrl = urlMatch[0].replace(/[.,;:!?)]+$/, "");
      }
      inFlags = false;
      inExamples = false;
      continue;
    }

    // Parse flags
    if (inFlags && line.match(/^\s+(-|\s+--)/)) {
      const flag = parseFlag(line);
      if (flag) {
        command.flags.push(flag);
      } else if (trimmed) {
        UNMATCHED_WARNINGS.push(`[${commandName}] ${trimmed}`);
      }
    }

    // Parse examples
    if (inExamples && trimmed && !trimmed.startsWith("Full documentation")) {
      if (trimmed.startsWith("bun ") || trimmed.startsWith("./") || trimmed.startsWith("Bundle")) {
        command.examples.push(trimmed);
      }
    }
  }

  // Special case for pm command
  if (commandName === "pm") {
    command.subcommands = parsePmSubcommands(helpText);
  }

  // Add dynamic completion info based on command
  command.dynamicCompletions = {};
  if (commandName === "run") {
    command.dynamicCompletions.scripts = true;
    command.dynamicCompletions.files = true;
    command.dynamicCompletions.binaries = true;
    // Also add file type info for positional args
    for (const arg of command.positionalArgs) {
      if (arg.name.includes("file") || arg.name.includes("script")) {
        arg.completionType = "javascript_files";
      }
    }
  } else if (commandName === "add") {
    command.dynamicCompletions.packages = true;
    // Mark package args
    for (const arg of command.positionalArgs) {
      if (arg.name.includes("package") || arg.name === "name") {
        arg.completionType = "package";
      }
    }
  } else if (commandName === "remove") {
    command.dynamicCompletions.packages = true; // installed packages
    for (const arg of command.positionalArgs) {
      if (arg.name.includes("package") || arg.name === "name") {
        arg.completionType = "installed_package";
      }
    }
  } else if (["test"].includes(commandName)) {
    command.dynamicCompletions.files = true;
    for (const arg of command.positionalArgs) {
      if (arg.name.includes("pattern") || arg.name.includes("file")) {
        arg.completionType = "test_files";
      }
    }
  } else if (["build"].includes(commandName)) {
    command.dynamicCompletions.files = true;
    for (const arg of command.positionalArgs) {
      if (arg.name === "entrypoint" || arg.name.includes("file")) {
        arg.completionType = "javascript_files";
      }
    }
  } else if (commandName === "create") {
    // Create has special template completions
    for (const arg of command.positionalArgs) {
      if (arg.name.includes("template")) {
        arg.completionType = "create_template";
      }
    }
  }

  return command;
}

/**
 * Get list of main commands from bun --help
 */
function getMainCommands(helpText: string): string[] {
  const lines = helpText.split("\n");
  const commands: string[] = [];

  let inCommands = false;
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "Commands:") {
      inCommands = true;
      continue;
    }

    // Stop when we hit the "Flags:" section
    if (inCommands && trimmed === "Flags:") {
      break;
    }

    if (inCommands && line.match(/^\s+\w+/)) {
      // Extract command name (first word after whitespace)
      const match = line.match(/^\s+(\w+)/);
      if (match) {
        commands.push(match[1]);
      }
    }
  }

  const commandsToRemove = ["lint"];

  return commands.filter((a) => {
    if (commandsToRemove.includes(a)) {
      return false;
    }
    return true;
  });
}

/**
 * Extract global flags from main help
 */
function parseGlobalFlags(helpText: string): FlagInfo[] {
  const lines = helpText.split("\n");
  const flags: FlagInfo[] = [];

  let inFlags = false;
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "Flags:") {
      inFlags = true;
      continue;
    }

    if (inFlags && (trimmed === "" || trimmed.startsWith("("))) {
      break;
    }

    if (inFlags && line.match(/^\s+(-|\s+--)/)) {
      const flag = parseFlag(line);
      if (flag) {
        flags.push(flag);
      } else if (trimmed) {
        UNMATCHED_WARNINGS.push(`[global] ${trimmed}`);
      }
    }
  }

  return flags;
}

/**
 * Add command aliases based on common patterns
 */
function addCommandAliases(commands: Record<string, CommandInfo>): void {
  const aliasMap: Record<string, string[]> = {
    install: ["i"],
    add: ["a"],
    remove: ["rm"],
    create: ["c"],
    x: ["bunx"], // bunx is an alias for bun x
  };

  for (const [command, aliases] of Object.entries(aliasMap)) {
    if (commands[command]) {
      commands[command].aliases = aliases;
    }
  }
}

/**
 * Main function to generate completion data
 */
/**
 * Known flag choices that Bun's --help output doesn't enumerate.
 * Sources: https://bun.com/docs/pm/cli/install and live help text.
 */
const CHOICE_FIXUPS: Record<string, Record<string, string[]>> = {
  install: {
    cpu: ["arm64", "x64", "ia32", "ppc64", "s390x", "*"],
    os: ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix", "*"],
    backend: ["hardlink", "clonefile", "clonefile_each_dir", "copyfile", "symlink"],
  },
  add: {
    cpu: ["arm64", "x64", "ia32", "ppc64", "s390x", "*"],
    os: ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix", "*"],
    backend: ["hardlink", "clonefile", "clonefile_each_dir", "copyfile", "symlink"],
  },
  remove: {
    cpu: ["arm64", "x64", "ia32", "ppc64", "s390x", "*"],
    os: ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix", "*"],
  },
  update: {
    cpu: ["arm64", "x64", "ia32", "ppc64", "s390x", "*"],
    os: ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix", "*"],
  },
  outdated: {
    cpu: ["arm64", "x64", "ia32", "ppc64", "s390x", "*"],
    os: ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix", "*"],
  },
  link: {
    cpu: ["arm64", "x64", "ia32", "ppc64", "s390x", "*"],
    os: ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix", "*"],
  },
  unlink: {
    cpu: ["arm64", "x64", "ia32", "ppc64", "s390x", "*"],
    os: ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix", "*"],
  },
  publish: {
    cpu: ["arm64", "x64", "ia32", "ppc64", "s390x", "*"],
    os: ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix", "*"],
  },
  patch: {
    cpu: ["arm64", "x64", "ia32", "ppc64", "s390x", "*"],
    os: ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix", "*"],
  },
  info: {
    cpu: ["arm64", "x64", "ia32", "ppc64", "s390x", "*"],
    os: ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix", "*"],
  },
  test: {
    "unhandled-rejections": ["strict", "throw", "warn", "none", "warn-with-error-code"],
  },
  run: {
    "unhandled-rejections": ["strict", "throw", "warn", "none", "warn-with-error-code"],
  },
  repl: {
    "unhandled-rejections": ["strict", "throw", "warn", "none", "warn-with-error-code"],
  },
};

/**
 * Known global flag choices that Bun's --help output doesn't enumerate cleanly.
 */
const GLOBAL_CHOICE_FIXUPS: Record<string, string[]> = {
  "unhandled-rejections": ["strict", "throw", "warn", "none", "warn-with-error-code"],
  backend: ["hardlink", "clonefile", "clonefile_each_dir", "copyfile", "symlink"],
};

function applyChoiceFixups(data: CompletionData): void {
  for (const flag of data.globalFlags) {
    const choices = GLOBAL_CHOICE_FIXUPS[flag.name];
    if (choices) {
      flag.choices = choices;
    }
  }

  for (const [commandName, flagFixups] of Object.entries(CHOICE_FIXUPS)) {
    const cmd = data.commands[commandName];
    if (!cmd) continue;
    for (const flag of cmd.flags) {
      const choices = flagFixups[flag.name];
      if (choices) {
        flag.choices = choices;
      }
    }
  }
}

async function generateCompletions(): Promise<void> {
  using tmpDir = createTempDir("bun-completion");
  writeText(
    `${tmpDir}/package.json`,
    JSON.stringify({
      name: "test",
      version: "1.0.0",
      scripts: {},
    })
  );

  console.log("🔍 Discovering Bun commands...");

  // Get main help and extract commands
  const mainHelpText = getHelpOutput([], String(tmpDir));
  const mainCommands = getMainCommands(mainHelpText);
  const globalFlags = parseGlobalFlags(mainHelpText);

  console.log(`📋 Found ${mainCommands.length} main commands: ${mainCommands.join(", ")}`);

  console.log("🌐 Fetching Bun API reference modules...");
  const apiModules = await fetchBunReferenceModules();
  console.log(`   - ${apiModules.length} API modules`);

  console.log("📚 Fetching Bun docs index...");
  const docs = await fetchBunDocsIndex();
  console.log(`   - ${docs.length} doc pages`);

  console.log("⚡ Fetching Bun runtime APIs...");
  const runtimeApis = await fetchRuntimeApis();
  console.log(`   - ${runtimeApis.length} runtime API topics`);

  const completionData: CompletionData = {
    version: "1.2.0",
    referenceUrl: "https://bun.com/reference",
    apiModules,
    docs,
    runtimeApis,
    commands: {},
    globalFlags,
    specialHandling: {
      bareCommand: {
        description:
          "Run JavaScript/TypeScript files directly or access package scripts and binaries",
        canRunFiles: true,
        dynamicCompletions: {
          scripts: true,
          files: true,
          binaries: true,
        },
      },
    },
    bunGetCompletes: {
      available: true,
      commands: {
        scripts: "bun getcompletes s", // or "bun getcompletes z" for scripts with descriptions
        binaries: "bun getcompletes b",
        packages: "bun getcompletes a", // takes prefix as argument
        files: "bun getcompletes j", // JavaScript/TypeScript files
      },
    },
  };

  // Parse each command
  for (const commandName of mainCommands) {
    console.log(`📖 Parsing help for: ${commandName}`);

    try {
      const helpText = getHelpOutput([commandName], String(tmpDir));
      if (helpText.trim()) {
        const commandInfo = parseHelpOutput(helpText, commandName);
        completionData.commands[commandName] = commandInfo;
      }
    } catch (error) {
      console.error(`❌ Failed to parse ${commandName}:`, error);
    }
  }

  // Add common aliases
  addCommandAliases(completionData.commands);

  // Fetch full Markdown docs for each CLI command (parallel, best-effort)
  console.log("📖 Fetching command documentation pages...");
  await Promise.all(
    Object.keys(completionData.commands).map(async (commandName) => {
      const page = docs.find((d) => d.title === commandName || d.title === `bun ${commandName}`);
      if (!page) return;

      try {
        const response = await fetch(page.url);
        if (!response.ok) return;
        const content = await response.text();

        const cmd = completionData.commands[commandName];
        cmd.docUrl = page.url;
        cmd.docContent = content;
        cmd.sections = parseDocSections(content, page.url);

        // If --help gave us no useful description, pull one from the doc page
        if (!cmd.description || cmd.description.startsWith("bun ")) {
          const firstLine = content
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l && !l.startsWith("#") && !l.startsWith(">"));
          if (firstLine) {
            cmd.description = firstLine.replace(/^>\s*/, "").replace(/\*+/g, "").trim();
          }
        }
      } catch {
        // ignore fetch errors
      }
    })
  );

  // Also check some common subcommands that might have their own help
  const additionalCommands = ["pm"];
  for (const commandName of additionalCommands) {
    if (!completionData.commands[commandName]) {
      console.log(`📖 Parsing help for additional command: ${commandName}`);

      try {
        const helpText = getHelpOutput([commandName], String(tmpDir));
        if (helpText.trim() && !helpText.includes("error:") && !helpText.includes("Error:")) {
          const commandInfo = parseHelpOutput(helpText, commandName);
          completionData.commands[commandName] = commandInfo;
        }
      } catch (error) {
        console.error(`❌ Failed to parse ${commandName}:`, error);
      }
    }
  }

  // Apply known choice fixups that Bun's --help output omits.
  applyChoiceFixups(completionData);

  // Ensure completions directory exists
  const completionsDir = `${Bun.cwd}/completions`;
  makeDir(completionsDir, { recursive: true });

  // Write the JSON file
  const outputPath = `${completionsDir}/bun-cli.json`;
  const jsonData = JSON.stringify(completionData, null, 2);

  writeText(outputPath, jsonData);
  writeShellCompletions(completionData, completionsDir);

  console.log(`✅ Generated CLI completion data at: ${outputPath}`);
  console.log(`📊 Statistics:`);
  console.log(`   - Commands: ${Object.keys(completionData.commands).length}`);
  console.log(`   - Global flags: ${completionData.globalFlags.length}`);
  console.log(`   - API reference modules: ${completionData.apiModules.length}`);
  console.log(`   - Doc pages: ${completionData.docs.length}`);
  console.log(`   - Runtime API topics: ${completionData.runtimeApis.length}`);

  let totalFlags = 0;
  let totalExamples = 0;
  let totalSubcommands = 0;
  for (const [name, cmd] of Object.entries(completionData.commands)) {
    totalFlags += cmd.flags.length;
    totalExamples += cmd.examples.length;
    const subcommandCount = cmd.subcommands ? Object.keys(cmd.subcommands).length : 0;
    totalSubcommands += subcommandCount;

    const aliasInfo = cmd.aliases ? ` (aliases: ${cmd.aliases.join(", ")})` : "";
    const subcommandInfo = subcommandCount > 0 ? `, ${subcommandCount} subcommands` : "";
    const dynamicInfo = cmd.dynamicCompletions
      ? ` [dynamic: ${Object.keys(cmd.dynamicCompletions).join(", ")}]`
      : "";

    console.log(
      `   - ${name}${aliasInfo}: ${cmd.flags.length} flags, ${cmd.positionalArgs.length} positional args, ${cmd.examples.length} examples${subcommandInfo}${dynamicInfo}`
    );
  }

  console.log(`   - Total command flags: ${totalFlags}`);
  console.log(`   - Total examples: ${totalExamples}`);
  console.log(`   - Total subcommands: ${totalSubcommands}`);

  if (UNMATCHED_WARNINGS.length > 0) {
    console.warn(`\n⚠ ${UNMATCHED_WARNINGS.length} flag line(s) could not be parsed:`);
    for (const warning of UNMATCHED_WARNINGS) {
      console.warn(`   ${warning}`);
    }
  }
}

/**
 * Generate a Bash completion script from completion data.
 */
function generateBashCompletion(data: CompletionData): string {
  const commandNames = Object.keys(data.commands);
  const aliasMap: Record<string, string> = {};
  for (const [name, cmd] of Object.entries(data.commands)) {
    for (const alias of cmd.aliases ?? []) {
      aliasMap[alias] = name;
    }
  }

  const allTopLevel = [...commandNames, ...Object.keys(aliasMap)].sort();
  const globalFlags = data.globalFlags.map((f) => `--${f.name}`).join(" ");
  const globalShortFlags = data.globalFlags
    .filter((f) => f.shortName)
    .map((f) => `-${f.shortName}`)
    .join(" ");

  function escapeForBash(word: string): string {
    return word.replace(/'/g, "'\\''");
  }

  const lines: string[] = [
    "# bash completion for bun",
    "# Generated by scripts/generate-cli-completions.ts — do not edit manually",
    "",
    "_bun_complete() {",
    "  local cur prev words cword cmd subcmd",
    "  _init_completion || return",
    "",
    "  # Find the command name (first non-option word)",
    "  for ((i = 1; i < ${#words[@]}; i++)); do",
    "    if [[ ${words[i]} != -* ]]; then",
    "      cmd=${words[i]}; break;",
    "    fi",
    "  done",
    "",
    "  # Resolve aliases to canonical command names",
    '  case "$cmd" in',
  ];

  for (const [alias, canonical] of Object.entries(aliasMap)) {
    lines.push(`    ${alias}) cmd=${canonical} ;;`);
  }

  lines.push(
    "  esac",
    "",
    "  # Complete top-level command",
    "  if [[ -z $cmd ]]; then",
    `    COMPREPLY=( $(compgen -W '${escapeForBash(allTopLevel.join(" "))}' -- "$cur") )`,
    "    return",
    "  fi",
    "",
    "  # Complete subcommands for pm",
    "  if [[ $cmd == pm ]]; then",
    "    local pm_subcmds='pack bin list why whoami view version pkg hash hash-string hash-print cache migrate untrusted trust default-trusted'",
    '    COMPREPLY=( $(compgen -W "$pm_subcmds" -- "$cur") )',
    "    return",
    "  fi",
    "",
    "  # Complete flags for the current command",
    "  local flags=''",
    '  case "$cmd" in'
  );

  for (const [name, cmd] of Object.entries(data.commands)) {
    const flags = [
      ...cmd.flags.map((f) => `--${f.name}`),
      ...cmd.flags.filter((f) => f.shortName).map((f) => `-${f.shortName}`),
    ].join(" ");
    lines.push(
      `    ${name}) flags='${escapeForBash(flags)} ${escapeForBash(globalFlags)} ${escapeForBash(globalShortFlags)}' ;;`
    );
  }

  lines.push(
    "  esac",
    "",
    "  if [[ $cur == -* ]]; then",
    '    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )',
    "    return",
    "  fi",
    "",
    "  # Dynamic completions via bun getcompletes",
    '  case "$cmd" in',
    "    run)",
    "      if [[ $cur == -* ]]; then return; fi",
    "      local scripts=$(bun getcompletes s 2>/dev/null)",
    '      COMPREPLY=( $(compgen -W "$scripts" -- "$cur") )',
    "      ;;",
    "    add)",
    "      if [[ $cur == -* ]]; then return; fi",
    "      COMPREPLY=()",
    "      ;;",
    "    remove)",
    "      if [[ $cur == -* ]]; then return; fi",
    '      local installed=$(bun getcompletes a "$cur" 2>/dev/null)',
    '      COMPREPLY=( $(compgen -W "$installed" -- "$cur") )',
    "      ;;",
    "    test|build)",
    "      if [[ $cur == -* ]]; then return; fi",
    "      local files=$(bun getcompletes j 2>/dev/null)",
    '      COMPREPLY=( $(compgen -W "$files" -- "$cur") )',
    "      ;;",
    "  esac",
    "}",
    "",
    "complete -F _bun_complete bun",
    ""
  );

  return lines.join("\n");
}

/**
 * Generate a Zsh completion script from completion data.
 */
function generateZshCompletion(data: CompletionData): string {
  const lines: string[] = [
    "#compdef bun",
    "# zsh completion for bun",
    "# Generated by scripts/generate-cli-completions.ts — do not edit manually",
    "",
    "_bun_commands() {",
    "  local -a commands",
    "  commands=(",
  ];

  for (const [name, cmd] of Object.entries(data.commands)) {
    lines.push(`    '${name}:${cmd.description.replace(/'/g, "'\\''")}'`);
  }

  lines.push(
    "  )",
    "  _describe -t commands 'bun command' commands",
    "}",
    "",
    "_bun_global_flags() {",
    "  local -a flags",
    "  flags=("
  );

  for (const flag of data.globalFlags) {
    const short = flag.shortName ? ` -${flag.shortName}` : "";
    lines.push(
      `    '(${short} --${flag.name})${short}--${flag.name}[${flag.description.replace(/'/g, "'\\''")}]'`
    );
  }

  lines.push(
    "  )",
    "  _arguments -s -S $flags",
    "}",
    "",
    "_bun_scripts() {",
    "  local -a scripts",
    '  scripts=(${(f)"$(bun getcompletes s 2>/dev/null)"})',
    "  _describe -t scripts 'package script' scripts",
    "}",
    "",
    "_bun_installed_packages() {",
    "  local -a packages",
    '  packages=(${(f)"$(bun getcompletes a "$words[$CURRENT]" 2>/dev/null)"})',
    "  _describe -t packages 'installed package' packages",
    "}",
    "",
    "_bun_files() {",
    "  _files -g '*.(js|ts|jsx|tsx|mjs|cjs)'",
    "}",
    "",
    "_bun() {",
    '  local curcontext="$curcontext" state line',
    "  typeset -A opt_args",
    "",
    "  _arguments -C \\",
    "    '1: :_bun_commands' \\",
    "    '*:: :->subcmd'",
    "",
    '  case "$state" in',
    "    subcmd)",
    '      case "$line[1]" in'
  );

  for (const [name, cmd] of Object.entries(data.commands)) {
    const aliases = cmd.aliases ?? [];
    const matchPattern = aliases.length > 0 ? `${name}|${aliases.join("|")}` : name;

    const flagSpecs: string[] = [];
    for (const flag of cmd.flags) {
      const short = flag.shortName ? ` -${flag.shortName}` : "";
      flagSpecs.push(
        `'(${short} --${flag.name})${short}--${flag.name}[${flag.description.replace(/'/g, "'\\''")}]'`
      );
    }

    lines.push(`        ${matchPattern})`);
    lines.push("          _arguments -s -S \\");
    for (let i = 0; i < flagSpecs.length; i++) {
      lines.push(`            ${flagSpecs[i]}${i < flagSpecs.length - 1 ? " \\" : ""}`);
    }
    if (flagSpecs.length === 0) {
      lines.push("            # no flags");
    }

    if (name === "run") {
      lines.push(
        "          _alternative \\",
        "            'scripts:package script:_bun_scripts' \\",
        "            'files:javascript file:_bun_files'"
      );
    } else if (name === "remove" || name === "rm") {
      lines.push("          _bun_installed_packages");
    } else if (name === "test" || name === "build") {
      lines.push("          _bun_files");
    }
    lines.push("          ;;");
  }

  lines.push("      esac", "      ;;", "  esac", "}", "", '_bun "$@"', "");

  return lines.join("\n");
}

/**
 * Generate a Fish completion script from completion data.
 */
function generateFishCompletion(data: CompletionData): string {
  const lines: string[] = [
    "# fish completion for bun",
    "# Generated by scripts/generate-cli-completions.ts — do not edit manually",
    "",
  ];

  // Top-level commands and aliases
  for (const [name, cmd] of Object.entries(data.commands)) {
    lines.push(
      `complete -c bun -n '__fish_use_subcommand' -a '${name}' -d '${cmd.description.replace(/'/g, "'\\''")}'`
    );
    for (const alias of cmd.aliases ?? []) {
      lines.push(
        `complete -c bun -n '__fish_use_subcommand' -a '${alias}' -d '${cmd.description.replace(/'/g, "'\\''")}'`
      );
    }
  }

  // Global flags
  for (const flag of data.globalFlags) {
    const short = flag.shortName ? ` -s ${flag.shortName}` : "";
    const desc = flag.description.replace(/'/g, "'\\''");
    lines.push(`complete -c bun -n '__fish_use_subcommand'${short} -l ${flag.name} -d '${desc}'`);
  }

  // Per-command flags
  for (const [name, cmd] of Object.entries(data.commands)) {
    const condition = `__fish_seen_subcommand_from ${name} ${(cmd.aliases ?? []).join(" ")}`;
    for (const flag of cmd.flags) {
      const short = flag.shortName ? ` -s ${flag.shortName}` : "";
      const desc = flag.description.replace(/'/g, "'\\''");
      const value = flag.hasValue ? " -r" : "";
      lines.push(`complete -c bun -n '${condition}'${short} -l ${flag.name}${value} -d '${desc}'`);
    }
  }

  // Dynamic completions via bun getcompletes
  lines.push("");
  lines.push("# Dynamic completions");
  lines.push(
    "complete -c bun -n '__fish_seen_subcommand_from run' -a '(bun getcompletes s 2>/dev/null)' -d 'script'"
  );
  lines.push(
    "complete -c bun -n '__fish_seen_subcommand_from remove rm' -a '(bun getcompletes a (commandline -ct) 2>/dev/null)' -d 'installed package'"
  );
  lines.push(
    "complete -c bun -n '__fish_seen_subcommand_from test build' -a '(bun getcompletes j 2>/dev/null)' -d 'file'"
  );

  return lines.join("\n");
}

/**
 * Write shell completion scripts alongside the JSON manifest.
 */
function writeShellCompletions(data: CompletionData, completionsDir: string): void {
  const bashPath = `${completionsDir}/bun.bash`;
  const fishPath = `${completionsDir}/bun.fish`;
  const zshPath = `${completionsDir}/bun.zsh`;

  writeText(bashPath, generateBashCompletion(data));
  writeText(fishPath, generateFishCompletion(data));
  writeText(zshPath, generateZshCompletion(data));

  console.log(`🐚 Generated shell completions:`);
  console.log(`   - ${bashPath}`);
  console.log(`   - ${fishPath}`);
  console.log(`   - ${zshPath}`);
}

// Run the script
if (import.meta.main) {
  generateCompletions().catch(console.error);
}
