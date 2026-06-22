#!/usr/bin/env bun
/**
 * check-secret-resolution.ts — Doctor gate: verify every CLI bin that spawns
 * child processes calls resolveDevSecrets() (or a specific resolver) first.
 *
 * Rule: if you spawn, you resolve first.
 *
 * Usage:
 *   bun run scripts/check-secret-resolution.ts
 *   bun run scripts/check-secret-resolution.ts --json
 */

import { join } from "path";

const args = process.argv.slice(2);
const JSON_MODE = args.includes("--json");
const ROOT = args.find((a) => !a.startsWith("--")) ?? ".";

const BIN_DIR = join(ROOT, "src", "bin");

interface Issue {
  file: string;
  severity: "error" | "warn";
  message: string;
}

async function main(): Promise<number> {
  const issues: Issue[] = [];

  // Known bins that are exempt (no external auth needed)
  const EXEMPT = new Set([
    "kimi-debug.ts",
    "kimi-snapshot.ts",
    "kimi-bake.ts",
    "kimi-identity.ts",
    "kimi-githooks.ts",
    "kimi-context-gen.ts",
    "kimi-secrets.ts",
    "kimi-orphan-kill.ts",
    "kimi-trace.ts",
    "kimi-why.ts",
    "kimi-memory.ts",
    "kimi-decision.ts",
    "kimi-error.ts",
    "kimi-capabilities.ts",
    "kimi-cleanup-legacy.ts",
    "kimi-config.ts",
    "kimi-contract.ts",
    "kimi-dashboard-mcp.ts",
    "kimi-dashboard.ts",
    "kimi-mcp.ts",
    "kimi-resource-governor.ts",
    "kimi-toolchain.ts",
    "kimi-cloudflare-access.ts",
    "kimi-heal.ts",
    "herdr-orchestrator.ts",
    "unified-shell-bridge.ts",
  ]);

  const dir = await Array.fromAsync(new Bun.Glob("*.ts").scan(BIN_DIR));

  for (const file of dir) {
    if (EXEMPT.has(file)) continue;

    const filePath = join(BIN_DIR, file);
    const text = await Bun.file(filePath).text();

    const hasSpawn =
      text.includes("Bun.spawn") ||
      text.includes("Bun.$") ||
      text.includes("$`") ||
      text.includes("runTool(");

    const hasResolver =
      text.includes("resolveDevSecrets") ||
      text.includes("resolveGithubEnv") ||
      text.includes("resolveNpmEnv") ||
      text.includes("resolveR2Env") ||
      text.includes("resolveDiscordEnv") ||
      text.includes("resolveTelegramEnv");

    if (hasSpawn && !hasResolver) {
      issues.push({
        file: `src/bin/${file}`,
        severity: "error",
        message: `spawns child processes but never calls resolveDevSecrets() or any resolver`,
      });
    }
  }

  if (JSON_MODE) {
    console.log(JSON.stringify({ issues, count: issues.length }, null, 2));
  } else {
    if (issues.length === 0) {
      console.log("✓ All spawning CLI bins resolve secrets before spawning");
    } else {
      console.log(`✗ ${issues.length} bin(s) spawn without resolving secrets:\n`);
      for (const issue of issues) {
        console.log(`  ${issue.severity === "error" ? "✗" : "⚠"} ${issue.file}: ${issue.message}`);
      }
    }
  }

  return issues.filter((i) => i.severity === "error").length;
}

process.exit(await main());
