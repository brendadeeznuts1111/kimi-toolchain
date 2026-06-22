#!/usr/bin/env bun
/**
 * kimi-secrets — Operational CLI for Bun.secrets management
 *
 * Subcommands:
 *   check          — Health check all registered secrets
 *   list           — List all registered secrets and their status
 *   get <svc> <n>  — Retrieve a secret value (masked by default)
 *   set <svc> <n>  — Store a secret value (prompts for value)
 *   rotate <svc> <n> — Rotate a secret to a new value
 *   delete <svc> <n> — Remove a secret from the keychain
 *   audit          — Query the audit trail
 *   init           — Initialize a secrets-policy.json5 template
 *
 * Usage:
 *   kimi-secrets check
 *   kimi-secrets list
 *   kimi-secrets get com.herdr.dashboard jwt-secret --consumer identity-service
 *   kimi-secrets set com.herdr.cli github-token
 *   kimi-secrets rotate com.herdr.dashboard csrf-secret --consumer identity-service
 *   kimi-secrets delete kimi-toolchain cloudflare-api-token
 *   kimi-secrets audit --service com.herdr.dashboard
 *   kimi-secrets init
 *   kimi-secrets --version
 *
 * Flags:
 *   --json          Output structured JSON
 *   --unmask        Show full secret values (use with caution)
 *   --project <dir> Project root (defaults to cwd)
 *   --consumer <n>  Consumer name for get/rotate operations
 */

import { Effect, Exit } from "effect";
import { createLogger } from "../lib/logger.ts";
import { isDirectRun } from "../lib/bun-utils.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { writeStdoutLine } from "../lib/cli-contract.ts";
import { buildBanner } from "../lib/build-info.ts";
import { SecretsManager } from "../lib/secrets-manager.ts";
import { quickCheck } from "../lib/install-secure.ts";
import type { AnySecretKey } from "../lib/secrets-types.ts";
import { statusLabel, colorError, colorSuccess } from "../lib/cli-format.ts";
import { printHelp } from "../lib/cli-help-generator.ts";

const logger = createLogger(Bun.argv, "kimi-secrets");

// ── Arg Parsing ──────────────────────────────────────────────────────

interface ParsedArgs {
  command: string;
  positional: string[];
  json: boolean;
  unmask: boolean;
  projectDir: string;
  consumer: string;
  since: string | undefined;
  service: string | undefined;
  name: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const command = args[0] ?? "check";
  const positional: string[] = [];
  let json = false;
  let unmask = false;
  let projectDir = Bun.cwd;
  let consumer = "cli";
  let since: string | undefined;
  let service: string | undefined;
  let name: string | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--unmask") {
      unmask = true;
    } else if (arg === "--project") {
      projectDir = args[++i] ?? Bun.cwd;
    } else if (arg === "--consumer") {
      consumer = args[++i] ?? "cli";
    } else if (arg === "--since") {
      since = args[++i];
    } else if (arg === "--service") {
      service = args[++i];
    } else if (arg === "--name") {
      name = args[++i];
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  return { command, positional, json, unmask, projectDir, consumer, since, service, name };
}

function maskValue(value: string): string {
  if (value.length <= 4) return "****";
  return value.slice(0, 2) + "•".repeat(Math.min(value.length - 4, 20)) + value.slice(-2);
}

function parseKey(positional: string[]): AnySecretKey {
  const service = positional[0];
  const name = positional[1];
  if (!service || !name) {
    throw new CliError({
      message: "Usage: kimi-secrets <command> <service> <name>",
    });
  }
  return { service, name };
}

// ── Subcommands ──────────────────────────────────────────────────────

async function cmdCheck(args: ParsedArgs): Promise<number> {
  const result = await quickCheck({ projectRoot: args.projectDir });

  if (args.json) {
    await writeStdoutLine(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }

  if (result.ok) {
    logger.info("All secrets healthy");
  } else {
    for (const w of result.warnings) {
      logger.warn(w);
    }
    for (const r of result.rotationRequired) {
      logger.error(`Rotation required: ${r}`);
    }
  }

  if (result.results.length > 0) {
    logger.section("Secret Status");
    logger.table(
      result.results.map((r) => ({
        Secret: `${r.key.service}:${r.key.name}`,
        Status: statusLabel(r.status),
        Stale: r.daysStale !== null && r.daysStale !== undefined ? `${r.daysStale}d` : "—",
        Rotation: r.rotationDays ? `${r.rotationDays}d` : "?",
      }))
    );
  }

  return result.ok ? 0 : 1;
}

async function cmdList(args: ParsedArgs): Promise<number> {
  const manager = new SecretsManager({ projectRoot: args.projectDir });
  const results = await Effect.runPromise(manager.list());

  if (args.json) {
    const output = results.map((r) => ({
      service: r.key.service,
      name: r.key.name,
      present: r.present,
      rotationDays: r.policy?.rotationDays ?? null,
      lastRotated: r.policy?.lastRotated ?? null,
      version: r.policy?.version ?? null,
    }));
    await writeStdoutLine(JSON.stringify(output));
    return 0;
  }

  if (results.length === 0) {
    logger.warn("No secrets registered in policy");
    logger.info("Run `kimi-secrets init` to create a secrets-policy.json5 template");
    return 0;
  }

  logger.section("Registered Secrets");
  logger.table(
    results.map((r) => ({
      Secret: `${r.key.service}:${r.key.name}`,
      Status: statusLabel(r.present ? "present" : "missing"),
      Rotation: r.policy?.rotationDays ? `${r.policy.rotationDays}d` : "—",
      Version: r.policy?.version ?? "—",
      "Last Rotated": r.policy?.lastRotated ?? "—",
    }))
  );
  return 0;
}

async function cmdGet(args: ParsedArgs): Promise<number> {
  const key = parseKey(args.positional);
  const manager = new SecretsManager({ projectRoot: args.projectDir });

  const exit = await Effect.runPromiseExit(manager.get(key, args.consumer));

  if (Exit.isSuccess(exit)) {
    const value = exit.value;
    if (value === null) {
      if (args.json) {
        await writeStdoutLine(JSON.stringify({ found: false }));
      } else {
        logger.error(`Secret not found: ${key.service}:${key.name}`);
      }
      return 1;
    }
    if (args.json) {
      await writeStdoutLine(
        JSON.stringify({ found: true, value: args.unmask ? value : maskValue(value) })
      );
    } else {
      logger.info(`${key.service}:${key.name} = ${args.unmask ? value : maskValue(value)}`);
    }
    return 0;
  }

  const err = exit.cause;
  if (err._tag === "Fail") {
    const e = err.error as { _tag: string; service?: string; name?: string; reason?: string };
    if (e._tag === "SecretNotFound") {
      logger.error(`Secret not found: ${e.service}:${e.name}`);
    } else if (e._tag === "SecretPolicyViolation") {
      logger.error(`Policy violation: ${e.service}:${e.name} — ${e.reason}`);
    } else {
      logger.error(String(e));
    }
  }
  return 1;
}

async function cmdSet(args: ParsedArgs): Promise<number> {
  const key = parseKey(args.positional);
  const manager = new SecretsManager({ projectRoot: args.projectDir });

  const value = prompt(`Enter value for ${key.service}:${key.name}:`)?.trim();
  if (!value) {
    logger.error("Value is required");
    return 1;
  }

  const exit = await Effect.runPromiseExit(manager.set(key, value));
  if (Exit.isSuccess(exit)) {
    logger.info(`Secret stored: ${key.service}:${key.name}`);
    return 0;
  }

  const err = exit.cause;
  if (err._tag === "Fail") {
    const e = err.error as { _tag: string; service?: string; name?: string; reason?: string };
    if (e._tag === "SecretPolicyViolation") {
      logger.error(`Policy violation: ${e.service}:${e.name} — ${e.reason}`);
    } else {
      logger.error(String(e));
    }
  }
  return 1;
}

async function cmdRotate(args: ParsedArgs): Promise<number> {
  const key = parseKey(args.positional);
  const manager = new SecretsManager({ projectRoot: args.projectDir });

  const newValue = prompt(`Enter new value for ${key.service}:${key.name}:`)?.trim();
  if (!newValue) {
    logger.error("New value is required");
    return 1;
  }

  const exit = await Effect.runPromiseExit(manager.rotate(key, newValue));
  if (Exit.isSuccess(exit)) {
    logger.info(`Secret rotated: ${key.service}:${key.name} → v${exit.value.version}`);
    logger.info(`Last rotated: ${exit.value.lastRotated}`);
    return 0;
  }

  const err = exit.cause;
  if (err._tag === "Fail") {
    const e = err.error as { _tag: string; service?: string; name?: string; reason?: string };
    if (e._tag === "SecretNotFound") {
      logger.error(`Secret not found: ${e.service}:${e.name}`);
    } else if (e._tag === "SecretPolicyViolation") {
      logger.error(`Policy violation: ${e.service}:${e.name} — ${e.reason}`);
    } else {
      logger.error(String(e));
    }
  }
  return 1;
}

async function cmdDelete(args: ParsedArgs): Promise<number> {
  const key = parseKey(args.positional);
  const manager = new SecretsManager({ projectRoot: args.projectDir });

  const deleted = await Effect.runPromise(manager.delete(key));
  if (deleted) {
    logger.info(`Secret deleted: ${key.service}:${key.name}`);
    return 0;
  }
  logger.warn(`Secret not found: ${key.service}:${key.name}`);
  return 1;
}

async function cmdAudit(args: ParsedArgs): Promise<number> {
  const manager = new SecretsManager({ projectRoot: args.projectDir });
  const records = await Effect.runPromise(
    manager.audit({
      since: args.since,
      service: args.service,
      name: args.name,
    })
  );

  if (args.json) {
    await writeStdoutLine(JSON.stringify(records));
    return 0;
  }

  if (records.length === 0) {
    logger.info("No audit records found");
    return 0;
  }

  logger.section(`Audit Trail (${records.length} records)`);
  logger.table(
    records.map((r) => ({
      Time: r.timestamp ?? "?",
      Status: r.success ? colorSuccess("✓") : colorError("✗"),
      Action: r.action,
      Secret: `${r.service}:${r.name}`,
      Consumer: r.consumer,
      Version: r.version ?? "—",
    }))
  );
  return 0;
}

async function cmdInit(args: ParsedArgs): Promise<number> {
  const { join } = await import("path");
  const { existsSync, writeFileSync } = await import("fs");
  const policyPath = join(args.projectDir, "secrets-policy.json5");

  if (existsSync(policyPath)) {
    logger.warn(`secrets-policy.json5 already exists at ${policyPath}`);
    return 1;
  }

  const template = `{
  $schema: "v1",

  // Legacy — migrated from cloudflare-access.ts hardcoded constants
  "kimi-toolchain": {
    "cloudflare-account-id": {
      allowedConsumers: ["kimi-cloudflare-access", "kimi-doctor"],
      rotationDays: 365,
      lastRotated: null,
      version: 1,
    },
    "cloudflare-api-token": {
      allowedConsumers: ["kimi-cloudflare-access", "kimi-doctor"],
      rotationDays: 90,
      lastRotated: null,
      version: 1,
    },
  },

  // CLI tool secrets
  "com.herdr.cli": {
    "github-token": {
      allowedConsumers: ["kimi-fix", "kimi-doctor"],
      rotationDays: 90,
      lastRotated: null,
      version: 1,
    },
    "github-api-domain": {
      allowedConsumers: ["kimi-fix", "kimi-doctor"],
      rotationDays: 365,
      lastRotated: null,
      version: 1,
    },
    "npm-token": {
      allowedConsumers: ["kimi-fix", "kimi-doctor"],
      rotationDays: 180,
      lastRotated: null,
      version: 1,
    },
    "bet365-api-key": {
      allowedConsumers: ["kimi-fix", "kimi-doctor"],
      rotationDays: 365,
      lastRotated: null,
      version: 1,
    },
    "r2-access-key-id": {
      allowedConsumers: ["kimi-fix", "kimi-doctor"],
      rotationDays: 365,
      lastRotated: null,
      version: 1,
    },
    "r2-secret-access-key": {
      allowedConsumers: ["kimi-fix", "kimi-doctor"],
      rotationDays: 90,
      lastRotated: null,
      version: 1,
    },
    "discord-webhook-url": {
      allowedConsumers: ["kimi-fix", "kimi-doctor"],
      rotationDays: 365,
      lastRotated: null,
      version: 1,
    },
    "telegram-bot-token": {
      allowedConsumers: ["kimi-fix", "kimi-doctor"],
      rotationDays: 90,
      lastRotated: null,
      version: 1,
    },
  },

  // Dashboard server secrets
  "com.herdr.dashboard": {
    "csrf-secret": {
      allowedConsumers: ["herdr-server", "webhook:named", "identity-service"],
      rotationDays: 30,
      lastRotated: null,
      version: 1,
    },
    "jwt-secret": {
      allowedConsumers: ["herdr-server", "webhook:named", "identity-service"],
      rotationDays: 30,
      lastRotated: null,
      version: 1,
    },
    "master-key": {
      allowedConsumers: ["herdr-server", "webhook:named"],
      rotationDays: 365,
      lastRotated: null,
      version: 1,
    },
  },

  // Security scanner
  "com.herdr.security": {
    "scanner-api-key": {
      allowedConsumers: ["bun-install"],
      rotationDays: 365,
      lastRotated: null,
      version: 1,
    },
  },
}`;

  writeFileSync(policyPath, template);
  logger.info(`Created secrets-policy.json5 at ${policyPath}`);
  logger.info(
    "Edit the file to register your secrets, then run `kimi-secrets set <service> <name>`"
  );
  return 0;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
    printHelp("kimi-secrets");
    return 0;
  }

  if (Bun.argv.includes("--version") || Bun.argv.includes("-v")) {
    writeStdoutLine(buildBanner);
    return 0;
  }

  const args = parseArgs(Bun.argv);

  switch (args.command) {
    case "check":
      return cmdCheck(args);
    case "list":
      return cmdList(args);
    case "get":
      return cmdGet(args);
    case "set":
      return cmdSet(args);
    case "rotate":
      return cmdRotate(args);
    case "delete":
      return cmdDelete(args);
    case "audit":
      return cmdAudit(args);
    case "init":
      return cmdInit(args);
    default:
      logger.error(`Unknown command: ${args.command}`);
      printHelp("kimi-secrets");
      return 1;
  }
}

if (isDirectRun(import.meta.path)) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        new CliError({
          message: e instanceof Error ? e.message : String(e),
        }),
    }),
    { toolName: "kimi-secrets", logger }
  );
  process.exit(exitCode);
}
