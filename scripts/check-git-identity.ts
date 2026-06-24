#!/usr/bin/env bun
/**
 * Git identity guard — prevents commits authored by placeholder identities.
 *
 * Run locally and in pre-commit / check:fast.
 */

import { $ } from "bun";

const FORBIDDEN = [
  { field: "user.name", pattern: /^Test$/i, example: '"nolarose"' },
  { field: "user.email", pattern: /^test@example\.com$/i, example: '"nolarose@example.com"' },
];

async function getConfig(scope: "local" | "global", key: string): Promise<string> {
  const result = await $`git config --${scope} ${key}`.quiet().nothrow();
  return result.stdout.toString().trim();
}

async function main(): Promise<number> {
  const localName = await getConfig("local", "user.name");
  const localEmail = await getConfig("local", "user.email");
  const globalName = await getConfig("global", "user.name");
  const globalEmail = await getConfig("global", "user.email");

  const name = localName || globalName;
  const email = localEmail || globalEmail;

  const errors: string[] = [];
  for (const { field, pattern, example } of FORBIDDEN) {
    const value = field === "user.name" ? name : email;
    if (!value || pattern.test(value)) {
      errors.push(
        `git ${field} is "${value || "(unset)"}" — set it with: git config --local ${field} ${example}`
      );
    }
  }

  if (errors.length > 0) {
    console.error("[git-identity] FAILED");
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }

  console.log(`[git-identity] OK: ${name} <${email}>`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
