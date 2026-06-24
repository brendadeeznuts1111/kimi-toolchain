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

function usage(): void {
  console.log("Usage: bun run secret <set|get|delete> <domain> <name> [value]");
  console.log("       service namespace: com.factory-wager.<domain>");
  process.exit(1);
}

async function main(): Promise<void> {
  if (!cmd || !domain || !name) usage();

  const service = domainService(domain);

  switch (cmd) {
    case "set": {
      if (!value) {
        console.error("Usage: bun run secret set <domain> <name> <value>");
        process.exit(1);
      }
      if (!isBunSecretsAvailable()) {
        console.error("Bun.secrets unavailable — cannot set secrets in this runtime");
        process.exit(1);
      }
      await setSecret(domain, name, value);
      console.log(`✅ Set ${domain}/${name} (${service})`);
      break;
    }
    case "get": {
      const secret = await getSecret(domain, name);
      if (secret == null) process.exit(1);
      console.log(secret);
      break;
    }
    case "delete": {
      if (!isBunSecretsAvailable()) {
        console.error("Bun.secrets unavailable — cannot delete secrets in this runtime");
        process.exit(1);
      }
      const deleted = await deleteSecret(domain, name);
      console.log(deleted ? `🗑 Deleted ${domain}/${name}` : `❌ Not found: ${domain}/${name}`);
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
