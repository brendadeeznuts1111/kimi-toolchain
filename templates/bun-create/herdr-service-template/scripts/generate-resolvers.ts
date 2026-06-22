#!/usr/bin/env bun
/**
 * generate-resolvers.ts — Generate a typed resolver map from _registry.ts.
 *
 * Reads `src/lib/_registry.ts` (containing SERVICE_ID and SECRET_NAMES) and
 * generates `src/lib/_resolvers.ts` with a typed resolver for each secret.
 *
 * Each resolver:
 *   1. Checks `process.env[ENV_VAR]` first (env takes priority)
 *   2. Falls back to `Bun.secrets.get({ service: SERVICE_ID, name })`
 *   3. Returns `string | null` (caller decides how to handle missing)
 *
 * Usage:
 *   bun run scripts/generate-resolvers.ts                    # write src/lib/_resolvers.ts
 *   bun run scripts/generate-resolvers.ts --check            # fail if stale
 *   bun run scripts/generate-resolvers.ts --json             # stdout only
 *   bun run scripts/generate-resolvers.ts --registry <path>  # custom registry path
 */

import { join, resolve } from "path";
import { existsSync, readFileSync } from "fs";

interface ParsedRegistry {
  serviceId: string;
  secretNames: string[];
}

function parseRegistry(registryPath: string): ParsedRegistry {
  if (!existsSync(registryPath)) {
    console.error(`generate-resolvers: registry not found at ${registryPath}`);
    console.error("  Run the template postinstall first, or create _registry.ts manually.");
    process.exit(1);
  }

  const content = readFileSync(registryPath, "utf-8");

  const serviceMatch = content.match(/export\s+const\s+SERVICE_ID\s*=\s*"([^"]+)"/);
  if (!serviceMatch) {
    console.error(`generate-resolvers: SERVICE_ID not found in ${registryPath}`);
    process.exit(1);
  }

  const namesMatch = content.match(/export\s+const\s+SECRET_NAMES\s*=\s*\[([^\]]*)\]/);
  if (!namesMatch) {
    console.error(`generate-resolvers: SECRET_NAMES not found in ${registryPath}`);
    process.exit(1);
  }

  const secretNames = namesMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/"/g, ""))
    .filter(Boolean);

  return { serviceId: serviceMatch[1], secretNames };
}

function envVarFor(secretName: string): string {
  return secretName.replace(/-/g, "_").toUpperCase();
}

function pascalFor(secretName: string): string {
  return secretName
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function generateResolvers(registry: ParsedRegistry): string {
  const { serviceId, secretNames } = registry;

  const resolvers = secretNames
    .map((name) => {
      const envVar = envVarFor(name);
      const pascal = pascalFor(name);
      return `/** Resolve ${name} from env (${envVar}) or Bun.secrets. */
export async function resolve${pascal}(): Promise<string | null> {
  if (process.env["${envVar}"]) return process.env["${envVar}"]!;
  return Bun.secrets.get({ service: SERVICE_ID, name: "${name}" });
}`;
    })
    .join("\n\n");

  const resolverMap = `export const SecretResolvers = {
${secretNames
  .map((name) => `  "${name}": resolve${pascalFor(name)},`)
  .join("\n")}
} as const satisfies Record<string, () => Promise<string | null>>;`;

  return `/**
 * _resolvers.ts — Auto-generated typed secret resolvers.
 *
 * DO NOT EDIT MANUALLY. Regenerate with:
 *   bun run scripts/generate-resolvers.ts
 *
 * Each resolver checks process.env first, then Bun.secrets.
 *
 * @generated
 */

import { SERVICE_ID, SECRET_NAMES } from "./_registry.ts";

${resolvers}

${resolverMap}

export type SecretResolverName = typeof SECRET_NAMES[number];
`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const jsonOnly = args.includes("--json");

  const registryIdx = args.indexOf("--registry");
  const registryPath =
    registryIdx !== -1 ? resolve(args[registryIdx + 1]) : join(process.cwd(), "src", "lib", "_registry.ts");

  const outputPath = join(process.cwd(), "src", "lib", "_resolvers.ts");

  const registry = parseRegistry(registryPath);
  const generated = generateResolvers(registry);

  if (jsonOnly) {
    process.stdout.write(generated);
    return;
  }

  if (check) {
    if (!existsSync(outputPath)) {
      console.error(`_resolvers.ts is missing — run: bun run scripts/generate-resolvers.ts`);
      process.exit(1);
    }
    const existing = readFileSync(outputPath, "utf-8");
    if (existing !== generated) {
      console.error(`_resolvers.ts is stale — run: bun run scripts/generate-resolvers.ts`);
      process.exit(1);
    }
    console.log(`_resolvers.ts OK (${registry.secretNames.length} resolvers for ${registry.serviceId})`);
    return;
  }

  await Bun.write(outputPath, generated);
  console.log(
    `wrote src/lib/_resolvers.ts (${registry.secretNames.length} resolvers for ${registry.serviceId})`
  );
}

main().catch((err: Error) => {
  console.error("generate-resolvers failed:", err.message);
  process.exit(1);
});
