#!/usr/bin/env bun
/**
 * kimi-mcp — Manage MCP servers, profiles, bridges, and probes.
 *
 * Commands:
 *   list [--json]                List registered servers and their status.
 *   probe [server] [--json]      Probe configured MCP servers (or one server).
 *   add <name> --command <cmd> [--args ...] [--json]
 *                                Register a new stdio MCP server.
 *   profile <name> [--json]      Apply a profile to ~/.kimi-code/mcp.json.
 *   scaffold <name> --kind <filesystem|http|sandbox|dashboard> [--json]
 *                                Generate a bridge script in ~/.kimi-code/tools/.
 *   doctor [--profile <name>]    Run MCP health checks.
 */

import { createLogger } from "../lib/logger.ts";
import {
  applyMcpProfile,
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
import { homeDir, toolsDir } from "../lib/paths.ts";
import { ensureDir } from "../lib/utils.ts";
import { join } from "path";

const logger = createLogger(Bun.argv, "kimi-mcp");

function hasFlag(flag: string): boolean {
  return Bun.argv.includes(flag);
}

function argValue(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return undefined;
  return Bun.argv[index + 1];
}

function argValues(flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < Bun.argv.length; i++) {
    if (Bun.argv[i] === flag && i + 1 < Bun.argv.length) {
      values.push(Bun.argv[i + 1]!);
    }
  }
  return values;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  logger.section("kimi-mcp commands");
  logger.line("  list [--json]");
  logger.line("  probe [server] [--json]");
  logger.line("  add <name> --command <cmd> [--args <arg>]... [--json]");
  logger.line("  profile <name> [--json]");
  logger.line("  scaffold <name> --kind <filesystem|http|sandbox|dashboard> [--json]");
  logger.line("  doctor [--profile <name>] [--json]");
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

  if (hasFlag("--json")) {
    writeJson({ servers: [...servers, ...extra] });
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
    results[name] = await probeMcpServer(merged);
  }

  if (hasFlag("--json")) {
    writeJson(results);
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
    logger.error("Usage: add <name> --command <cmd> [--args <arg>]... [--json]");
    return 1;
  }
  const command = argValue("--command");
  const args = argValues("--args");
  const url = argValue("--url");
  if (!command && !url) {
    logger.error("Either --command or --url is required");
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
    description: argValue("--description"),
  };
  await writeMcpJson(path, config);

  if (hasFlag("--json")) {
    writeJson({ added: name, path });
  } else {
    logger.info(`Added ${name} to ${path}`);
  }
  return 0;
}

async function profileCommand(): Promise<number> {
  const name = Bun.argv[3];
  if (!name || name.startsWith("-")) {
    logger.error("Usage: profile <name> [--json]");
    return 1;
  }

  const path = userMcpPath();
  const { data: existing } = await readMcpJson(path);
  if (!existing) {
    logger.error(`No MCP config at ${path}`);
    return 1;
  }
  if (!existing.profiles?.[name]) {
    logger.error(`Profile ${name} not found`);
    return 1;
  }

  const applied = applyMcpProfile(existing, name);
  await writeMcpJson(path, applied);

  if (hasFlag("--json")) {
    writeJson({ profile: name, servers: applied.mcpServers });
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
  const kind = argValue("--kind") as BridgeKind | undefined;
  if (
    !name ||
    name.startsWith("-") ||
    !kind ||
    !["filesystem", "http", "sandbox", "dashboard"].includes(kind)
  ) {
    logger.error("Usage: scaffold <name> --kind <filesystem|http|sandbox|dashboard> [--json]");
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
      targetUrl: argValue("--url"),
      allowedPaths: argValues("--allow"),
    })
  );

  if (hasFlag("--json")) {
    writeJson({ scaffolded: path, kind });
  } else {
    logger.info(`Scaffolded ${kind} bridge at ${path}`);
    logger.line(
      `  Register with: kimi-mcp add ${name}-${kind} --command bun --args run --args ${path}`
    );
  }
  return 0;
}

async function doctorCommand(): Promise<number> {
  const profile = argValue("--profile");
  const report = await validateMcpConfig(homeDir(), process.cwd(), { probe: true, profile });
  const errors = report.checks.filter((c) => c.status === "error").length;
  const warnings = report.checks.filter((c) => c.status === "warn").length;

  if (hasFlag("--json")) {
    writeJson(report);
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

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] ?? "help";

  if (command === "help" || hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return 0;
  }

  if (command === "list") return await listCommand();
  if (command === "probe") return await probeCommand();
  if (command === "add") return await addCommand();
  if (command === "profile") return await profileCommand();
  if (command === "scaffold") return await scaffoldCommand();
  if (command === "doctor") return await doctorCommand();

  logger.error(`Unknown command: ${command}`);
  printHelp();
  return 1;
}

main().then((code) => process.exit(code));
