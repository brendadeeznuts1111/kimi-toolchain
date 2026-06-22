#!/usr/bin/env bun
/**
 * kimi-secrets — Bun.secrets policy CLI
 *
 * Usage:
 *   kimi-secrets check|list|storage|gate|doctor|rotate <service> <name> [--value <secret>] [--json]
 */

import { isDirectRun } from "../lib/bun-utils.ts";
import { resolveProjectRoot } from "../lib/utils.ts";
import { createLogger } from "../lib/logger.ts";
import { parseCliFlags } from "../lib/cli-contract.ts";
import {
  cmdSecretsCheck,
  cmdSecretsDoctor,
  cmdSecretsGate,
  cmdSecretsList,
  cmdSecretsRotate,
  cmdSecretsStorage,
  printSecretsHelp,
} from "../lib/secrets-cli.ts";

const logger = createLogger(Bun.argv, "kimi-secrets");

function argValue(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return undefined;
  return Bun.argv[index + 1];
}

async function main(): Promise<number> {
  const { json } = parseCliFlags(Bun.argv, "kimi-secrets");
  const argv = Bun.argv.slice(2).filter((a) => !a.startsWith("--"));
  const command = argv[0];

  if (!command || command === "help" || command === "-h") {
    printSecretsHelp();
    return command ? 0 : 1;
  }

  const projectRoot = await resolveProjectRoot(Bun.cwd);
  const opts = { projectRoot, json };

  switch (command) {
    case "check":
      return cmdSecretsCheck(opts);
    case "list":
      return cmdSecretsList(opts);
    case "storage":
      return cmdSecretsStorage(opts);
    case "gate":
      return cmdSecretsGate(opts);
    case "doctor":
      return cmdSecretsDoctor(opts);
    case "rotate": {
      const service = argv[1];
      const name = argv[2];
      if (!service || !name) {
        logger.error("Usage: kimi-secrets rotate <service> <name> [--value <secret>]");
        return 1;
      }
      return cmdSecretsRotate(opts, service, name, argValue("--value"));
    }
    default:
      logger.error(`Unknown command: ${command}`);
      printSecretsHelp();
      return 1;
  }
}

if (isDirectRun(import.meta.path)) {
  const code = await main();
  if (code !== 0) process.exit(code);
}
