#!/usr/bin/env bun
/**
 * kimi-mcp — Manage MCP servers, profiles, bridges, and probes.
 *
 * Commands:
 *   list [--json] [--quiet]
 *   probe [server] [--json]
 *   add <name> --command <cmd> [--args ...] [--json]
 *   profile <name> [--json]
 *   scaffold <name> --kind <filesystem|http|sandbox|dashboard> [--json]
 *   doctor [--profile <name>] [--json]
 *   bun-docs [query] [--tool search_bun|query_docs_filesystem_bun] [--json] [--refresh]
 *   query <text> [--tool ...] [--json] [--refresh]
 *   fs <command> [--top N] [--json] [--refresh]
 *   catalog [--probe] [--json]
 *   version-policy [--json] [--root <path>]
 */

import { isDirectRun } from "../lib/bun-utils.ts";
import { createCli } from "../lib/cli-contract.ts";
import {
  applyMcpProfile,
  buildMcpCatalogReport,
  readMcpJson,
  userMcpPath,
  validateMcpConfig,
  writeMcpJson,
  type McpJson,
} from "../lib/mcp-config.ts";
import {
  bridgeScriptName,
  generateBridgeScript,
  type BridgeKind,
} from "../lib/mcp-bridge-scaffold.ts";
import { loadMcpRegistry, serverEnvAvailable } from "../lib/mcp-registry.ts";
import { probeMcpServer } from "../lib/mcp-probe.ts";
import {
  buildBunDocsKnowledgeCard,
  clearBunDocsMcpCache,
  formatBunDocsContent,
  queryBunDocsFilesystem,
  searchBunDocs,
} from "../lib/bun-docs-mcp.ts";
import { BUN_DOCS_MCP_TOOLS } from "../lib/mcp-registry.ts";
import { homeDir, toolsDir } from "../lib/paths.ts";
import { ensureDir } from "../lib/utils.ts";
import { join, resolve } from "path";
import { buildMcpVersionPolicyReport } from "../lib/mcp-version-policy.ts";
import { resolveProjectRoot } from "../lib/utils.ts";

const writer = createCli(Bun.argv, "kimi-mcp");
const logger = writer.logger;

const BRIDGE_KINDS = ["filesystem", "http", "sandbox", "dashboard"] as const;
type BridgeKindLiteral = (typeof BRIDGE_KINDS)[number];

type BunDocsTool = (typeof BUN_DOCS_MCP_TOOLS)[number];

/** Limit CLI doc output to the first N lines (`--top`). */
export function trimBunDocsOutput(text: string, top?: number): string {
  if (!top || top <= 0) return text;
  return text.split("\n").slice(0, top).join("\n");
}

/** Parse `--top N` from argv; returns undefined when absent or invalid. */
export function parseTopArg(argv: string[]): number | undefined {
  const raw = argValue(argv, "--top");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** Extract the value for a `--flag value` or `--flag=value` option. */
export function argValue(argv: string[], flag: string): string | undefined {
  const prefix = `${flag}=`;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === flag && i + 1 < argv.length) {
      return argv[i + 1];
    }
    if (arg?.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return undefined;
}

/** Collect all values for a repeatable flag. */
export function argValues(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === flag && i + 1 < argv.length) {
      values.push(argv[i + 1]!);
    }
  }
  return values;
}

/** True when a boolean flag is present. */
export function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

/**
 * Join positional arguments after the subcommand, excluding flags and their values.
 * `fromIndex` points to the first positional after the subcommand name.
 */
export function positionalArgs(argv: string[], fromIndex: number): string {
  const out: string[] = [];
  for (let i = fromIndex; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith("-")) {
      // Skip the value if the next token is not another flag.
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) i++;
      continue;
    }
    out.push(arg);
  }
  return out.join(" ").trim();
}

interface Subcommand {
  name: string;
  description: string;
  usage: string;
  run: () => Promise<number>;
}

function printGlobalHelp(): void {
  logger.section("kimi-mcp commands");
  for (const cmd of COMMAND_LIST) {
    logger.line(`  ${cmd.usage}`);
  }
}

function printSubcommandHelp(cmd: Subcommand): void {
  logger.section(cmd.name);
  logger.line(cmd.description);
  logger.line(`Usage: kimi-mcp ${cmd.usage}`);
}

async function listCommand(): Promise<number> {
  const home = homeDir();
  const registry = await loadMcpRegistry(home);
  const userMcp = await readMcpJson(userMcpPath());
  const configured = userMcp.data?.mcpServers ?? {};

  const servers = Object.values(registry.servers).map((def) => {
    const entry = configured[def.name];
    return {
      name: def.name,
      builtin: !registry.userNames.includes(def.name),
      registered: true,
      configured: !!entry,
      enabled: entry ? entry.enabled !== false : def.default !== false,
      envAvailable: serverEnvAvailable(def),
      description: def.description,
    };
  });

  const extra = Object.entries(configured)
    .filter(([name]) => !registry.servers[name])
    .map(([name, entry]) => ({
      name,
      builtin: false,
      registered: false,
      configured: true,
      enabled: entry.enabled !== false,
      envAvailable: true,
      description: "custom",
    }));

  if (writer.flags.json) {
    writer.writeJson({ servers: [...servers, ...extra] });
  } else {
    logger.section("MCP Servers");
    for (const server of [...servers, ...extra]) {
      const flags = [
        server.builtin ? "builtin" : "user",
        server.configured ? "configured" : "not-configured",
        server.enabled ? "enabled" : "disabled",
        server.envAvailable ? null : "env-missing",
      ]
        .filter(Boolean)
        .join(", ");
      logger.line(
        `  ${server.name} [${flags}]${server.description ? ` — ${server.description}` : ""}`
      );
    }
  }
  return 0;
}

async function probeCommand(): Promise<number> {
  const home = homeDir();
  const registry = await loadMcpRegistry(home);
  const userMcp = await readMcpJson(userMcpPath());
  const configured = userMcp.data?.mcpServers ?? {};
  const target = Bun.argv[3];

  const names = target && !target.startsWith("-") ? [target] : Object.keys(configured);
  const results: Record<string, { ok: boolean; tools?: string[]; error?: string }> = {};

  for (const name of names) {
    const entry = configured[name];
    const def = registry.servers[name];
    if (!entry || entry.enabled === false) {
      results[name] = { ok: false, error: "not configured or disabled" };
      continue;
    }
    const merged = { ...(def ?? { name }), ...entry };
    results[name] = await probeMcpServer(merged, writer.flags.timeout);
  }

  if (writer.flags.json) {
    writer.writeJson(results);
  } else {
    logger.section("MCP Probes");
    for (const [name, result] of Object.entries(results)) {
      if (result.ok) {
        logger.info(`${name}: ${result.tools?.length ?? 0} tool(s)`);
      } else {
        logger.warn(`${name}: ${result.error}`);
      }
    }
  }
  return 0;
}

async function addCommand(): Promise<number> {
  const name = Bun.argv[3];
  if (!name || name.startsWith("-")) {
    printSubcommandHelp(COMMANDS.add);
    return 1;
  }
  const command = argValue(Bun.argv, "--command");
  const args = argValues(Bun.argv, "--args");
  const url = argValue(Bun.argv, "--url");
  if (!command && !url) {
    writer.error("Either --command or --url is required");
    printSubcommandHelp(COMMANDS.add);
    return 1;
  }

  const path = userMcpPath();
  const { data: existing } = await readMcpJson(path);
  const config: McpJson = {
    mcpServers: existing?.mcpServers ? { ...existing.mcpServers } : {},
    profiles: existing?.profiles ? { ...existing.profiles } : {},
  };
  config.mcpServers[name] = {
    ...(command ? { command, args: args.length > 0 ? args : undefined } : {}),
    ...(url ? { url } : {}),
    description: argValue(Bun.argv, "--description"),
  };
  await writeMcpJson(path, config);

  if (writer.flags.json) {
    writer.writeJson({ added: name, path });
  } else {
    logger.info(`Added ${name} to ${path}`);
  }
  return 0;
}

async function profileCommand(): Promise<number> {
  const name = Bun.argv[3];
  if (!name || name.startsWith("-")) {
    printSubcommandHelp(COMMANDS.profile);
    return 1;
  }

  const path = userMcpPath();
  const { data: existing } = await readMcpJson(path);
  if (!existing) {
    writer.error(`No MCP config at ${path}`);
    return 1;
  }
  if (!existing.profiles?.[name]) {
    writer.error(`Profile ${name} not found`);
    return 1;
  }

  const applied = applyMcpProfile(existing, name);
  await writeMcpJson(path, applied);

  if (writer.flags.json) {
    writer.writeJson({ profile: name, servers: applied.mcpServers });
  } else {
    logger.info(`Applied profile ${name}`);
    for (const [server, entry] of Object.entries(applied.mcpServers)) {
      logger.line(`  ${server}: ${entry.enabled === false ? "disabled" : "enabled"}`);
    }
  }
  return 0;
}

async function scaffoldCommand(): Promise<number> {
  const name = Bun.argv[3];
  const kind = argValue(Bun.argv, "--kind") as BridgeKind | undefined;
  if (!name || name.startsWith("-") || !kind || !BRIDGE_KINDS.includes(kind as BridgeKindLiteral)) {
    writer.error(
      kind && !BRIDGE_KINDS.includes(kind as BridgeKindLiteral)
        ? `Invalid --kind: ${kind}. Valid: ${BRIDGE_KINDS.join(", ")}`
        : "Missing required arguments"
    );
    printSubcommandHelp(COMMANDS.scaffold);
    return 1;
  }

  const home = homeDir();
  const dir = toolsDir(home);
  ensureDir(dir);
  const fileName = bridgeScriptName(name, kind);
  const path = join(dir, fileName);
  await Bun.write(
    path,
    generateBridgeScript({
      kind,
      name,
      projectRoot: process.cwd(),
      targetUrl: argValue(Bun.argv, "--url"),
      allowedPaths: argValues(Bun.argv, "--allow"),
    })
  );

  if (writer.flags.json) {
    writer.writeJson({ scaffolded: path, kind });
  } else {
    logger.info(`Scaffolded ${kind} bridge at ${path}`);
    logger.line(
      `  Register with: kimi-mcp add ${name}-${kind} --command bun --args run --args ${path}`
    );
  }
  return 0;
}

async function doctorCommand(): Promise<number> {
  const profile = argValue(Bun.argv, "--profile");
  const report = await validateMcpConfig(homeDir(), process.cwd(), {
    probe: true,
    profile,
  });
  const errors = report.checks.filter((c) => c.status === "error").length;
  const warnings = report.checks.filter((c) => c.status === "warn").length;

  if (writer.flags.json) {
    writer.writeJson(report);
  } else {
    logger.section("MCP Doctor");
    for (const check of report.checks) {
      const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
      logger.line(`  ${icon} ${check.name}: ${check.message}`);
    }
    logger.info(`${errors} error(s), ${warnings} warning(s)`);
  }
  return errors > 0 ? 1 : 0;
}

function resolveBunDocsTool(): BunDocsTool | undefined {
  const tool = argValue(Bun.argv, "--tool") ?? "search_bun";
  if ((BUN_DOCS_MCP_TOOLS as readonly string[]).includes(tool)) {
    return tool as BunDocsTool;
  }
  writer.error(`Invalid --tool: ${tool}. Valid: ${BUN_DOCS_MCP_TOOLS.join(", ")}`);
  return undefined;
}

async function runBunDocsSearch(query: string, toolOverride?: BunDocsTool): Promise<number> {
  const tool = toolOverride ?? resolveBunDocsTool();
  if (!tool) return 1;
  const refresh = hasFlag(Bun.argv, "--refresh");
  const timeoutMs = writer.flags.timeout ?? 30000;
  if (refresh) clearBunDocsMcpCache();
  const result =
    tool === "search_bun"
      ? await searchBunDocs(query, timeoutMs, { refresh })
      : await queryBunDocsFilesystem(query, timeoutMs, { refresh });
  const top = parseTopArg(Bun.argv);
  const text = trimBunDocsOutput(formatBunDocsContent(result.content), top);
  if (writer.flags.json) {
    writer.writeJson({
      ok: result.ok,
      tool,
      query,
      top,
      text,
      error: result.error,
    });
  } else if (result.ok) {
    logger.line(text);
  } else {
    writer.error(result.error ?? "search failed");
  }
  return result.ok ? 0 : 1;
}

async function bunDocsCommand(): Promise<number> {
  if (hasFlag(Bun.argv, "--help")) {
    printSubcommandHelp(COMMANDS["bun-docs"]);
    return 0;
  }
  const query = positionalArgs(Bun.argv, 3);
  if (query) return runBunDocsSearch(query);
  const timeoutMs = writer.flags.timeout ?? 15000;
  const card = await buildBunDocsKnowledgeCard(timeoutMs);
  if (writer.flags.json) {
    writer.writeJson(card);
  } else {
    logger.info(`${card.server}: ${card.toolCount} tools`);
  }
  return card.ok ? 0 : 1;
}

async function queryCommand(): Promise<number> {
  if (hasFlag(Bun.argv, "--help")) {
    printSubcommandHelp(COMMANDS.query);
    return 0;
  }
  const query = positionalArgs(Bun.argv, 3);
  if (!query) {
    printSubcommandHelp(COMMANDS.query);
    return 1;
  }
  return runBunDocsSearch(query);
}

async function fsCommand(): Promise<number> {
  if (hasFlag(Bun.argv, "--help")) {
    printSubcommandHelp(COMMANDS.fs);
    return 0;
  }
  const command = positionalArgs(Bun.argv, 3);
  if (!command) {
    printSubcommandHelp(COMMANDS.fs);
    return 1;
  }
  return runBunDocsSearch(command, "query_docs_filesystem_bun");
}

async function catalogCommand(): Promise<number> {
  const rootArg = argValue(Bun.argv, "--root");
  let projectRoot: string;
  if (rootArg) {
    projectRoot = resolve(rootArg);
  } else {
    try {
      projectRoot = await resolveProjectRoot(process.cwd());
    } catch {
      projectRoot = process.cwd();
    }
  }
  const report = await buildMcpCatalogReport(homeDir(), {
    probe: hasFlag(Bun.argv, "--probe"),
    projectRoot,
  });
  if (writer.flags.json) {
    writer.writeJson(report);
  } else {
    for (const meta of report.catalog) logger.line(`  ${meta.serverName} [${meta.layer}]`);
    if (report.versionPolicy) {
      logger.line(
        `  version: runtime ${report.versionPolicy.policy.runtimeBun} · engines ok=${report.versionPolicy.policy.runtimeSatisfiesEngines}`
      );
    }
  }
  return 0;
}

async function versionPolicyCommand(): Promise<number> {
  const rootArg = argValue(Bun.argv, "--root");
  let projectRoot: string;
  if (rootArg) {
    projectRoot = resolve(rootArg);
  } else {
    try {
      projectRoot = await resolveProjectRoot(process.cwd());
    } catch {
      projectRoot = process.cwd();
    }
  }
  const report = await buildMcpVersionPolicyReport(projectRoot);
  if (writer.flags.json) {
    writer.writeJson(report);
  } else {
    logger.section("Bun version policy");
    logger.line(`  runtime:     ${report.policy.runtimeBun}`);
    logger.line(`  pin:         ${report.policy.packageManager ?? "unset"}`);
    logger.line(`  engines.bun: ${report.policy.enginesBun ?? report.policy.enginesRangeHardened}`);
    logger.line(`  satisfies:   engines=${report.policy.runtimeSatisfiesEngines}`);
    logger.line(`  semver docs: ${report.semverDocUrl}`);
    for (const row of report.packageJsonPolicy) {
      logger.line(`  ${row.key}: ${row.status} (current=${row.current ?? "unset"})`);
    }
  }
  return report.policy.runtimeSatisfiesEngines &&
    report.packageJsonPolicy.every((row) => row.status === "ok")
    ? 0
    : 1;
}

const COMMANDS: Record<string, Subcommand> = {
  list: {
    name: "list",
    description: "List registered MCP servers and their configuration status.",
    usage: "list [--json]",
    run: listCommand,
  },
  probe: {
    name: "probe",
    description: "Probe configured MCP servers (or one server) and report tool availability.",
    usage: "probe [server] [--json] [--timeout <ms>]",
    run: probeCommand,
  },
  add: {
    name: "add",
    description: "Register a new stdio or HTTP MCP server in ~/.kimi-code/mcp.json.",
    usage: "add <name> --command <cmd> [--args <arg>]... [--json]",
    run: addCommand,
  },
  profile: {
    name: "profile",
    description: "Apply a server profile to the user MCP config.",
    usage: "profile <name> [--json]",
    run: profileCommand,
  },
  scaffold: {
    name: "scaffold",
    description: "Generate a bridge script in ~/.kimi-code/tools/.",
    usage: "scaffold <name> --kind <filesystem|http|sandbox|dashboard> [--json]",
    run: scaffoldCommand,
  },
  doctor: {
    name: "doctor",
    description: "Run MCP health checks against user and project config.",
    usage: "doctor [--profile <name>] [--json]",
    run: doctorCommand,
  },
  "bun-docs": {
    name: "bun-docs",
    description: "Search the Bun documentation MCP, or show the Bun docs knowledge card.",
    usage:
      "bun-docs [query] [--tool search_bun|query_docs_filesystem_bun] [--json] [--refresh] [--timeout <ms>]",
    run: bunDocsCommand,
  },
  query: {
    name: "query",
    description: "Search the Bun documentation MCP (alias for 'bun-docs search').",
    usage:
      "query <text> [--tool search_bun|query_docs_filesystem_bun] [--json] [--refresh] [--timeout <ms>]",
    run: queryCommand,
  },
  fs: {
    name: "fs",
    description: "Run a filesystem command against the Bun docs MCP filesystem.",
    usage: "fs <command> [--top N] [--json] [--refresh] [--timeout <ms>]",
    run: fsCommand,
  },
  catalog: {
    name: "catalog",
    description: "List built-in MCP server metadata and optional probe results.",
    usage: "catalog [--probe] [--json] [--root <path>]",
    run: catalogCommand,
  },
  "version-policy": {
    name: "version-policy",
    description:
      "Report packageManager pin + engines.bun semver policy (Bun.semver.satisfies / order).",
    usage: "version-policy [--json] [--root <path>]",
    run: versionPolicyCommand,
  },
};

const COMMAND_LIST = Object.values(COMMANDS);

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printGlobalHelp();
    return 0;
  }

  const subcommand = COMMANDS[command];
  if (!subcommand) {
    writer.error(`Unknown command: ${command}`);
    printGlobalHelp();
    return 1;
  }

  return subcommand.run();
}

if (isDirectRun(import.meta.path)) {
  main().then((code) => process.exit(code));
}
