#!/usr/bin/env bun
/**
 * Thin CLI for domain-scoped Bun.secrets (until native `bun secret` lands).
 *
 * Usage:
 *   bun run secret set <domain> <name> <value>
 *   bun run secret get <domain> <name>
 *   bun run secret delete <domain> <name>
 */

import { deleteSecret, domainService, getSecret, setSecret } from "../src/lib/secrets.ts";
import { isBunSecretsAvailable } from "../src/lib/secrets-storage.ts";

const [cmd, domain, name, value] = Bun.argv.slice(2);

function usage(): never {
  console.log("Usage: bun run secret <set|get|delete> <domain> <name> [value]");
  console.log("       service namespace: com.factory-wager.<domain>");
  process.exit(1);
}

async function main(): Promise<void> {
  if (!cmd || !domain || !name) usage();
  const command = cmd;
  const targetDomain = domain;
  const targetName = name;

  const service = domainService(targetDomain);

  switch (command) {
    case "set": {
      if (!value) {
        console.error("Usage: bun run secret set <domain> <name> <value>");
        process.exit(1);
      }
      if (!isBunSecretsAvailable()) {
        console.error("Bun.secrets unavailable — cannot set secrets in this runtime");
        process.exit(1);
      }
      await setSecret(targetDomain, targetName, value);
      console.log(`✅ Set ${targetDomain}/${targetName} (${service})`);
      break;
    }
    case "get": {
      const secret = await getSecret(targetDomain, targetName);
      if (secret == null) process.exit(1);
      console.log(secret);
      break;
    }
    case "delete": {
      if (!isBunSecretsAvailable()) {
        console.error("Bun.secrets unavailable — cannot delete secrets in this runtime");
        process.exit(1);
      }
      const deleted = await deleteSecret(targetDomain, targetName);
      console.log(
        deleted
          ? `🗑 Deleted ${targetDomain}/${targetName}`
          : `❌ Not found: ${targetDomain}/${targetName}`
      );
      process.exit(deleted ? 0 : 1);
      break;
    }
    default:
      usage();
  }
}

if (import.meta.main) {
  await main();
}
