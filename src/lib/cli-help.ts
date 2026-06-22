/**
 * cli-help.ts — CLI help text constants embedded at build time via Bun macros.
 *
 * Help text is read from source files at BUILD TIME and inlined as static
 * strings. This means:
 *   - No file reads at runtime to display help
 *   - Help text is frozen at build time (matches the deployed version)
 *   - Smaller runtime footprint
 *
 * Usage:
 *   import { kimiSecretsHelp, kimiGuardianHelp, generalHelp }
 *     from "./cli-help.ts";
 */

import { getBuildTime, getGitHash } from "./build-info-macros.ts" with { type: "macro" };

// ── Build stamp for help output ──────────────────────────────────────

const buildStamp = `Build: ${getGitHash()} @ ${getBuildTime()}`;

// ── kimi-secrets Help ────────────────────────────────────────────────

export const kimiSecretsHelp = `kimi-secrets — Secret management CLI

${buildStamp}

Usage:
  kimi-secrets <command> [options] [service] [name]

Commands:
  check    Quick health check of all registered secrets
  list     List all registered secrets with status
  get      Get a secret value (masked by default)
  set      Set or update a secret value
  rotate   Rotate a secret (generate new value, update audit trail)
  delete   Delete a secret from the store
  audit    Show audit trail for secret access
  init     Create a secrets-policy.json5 template

Options:
  --json          Output as JSON
  --unmask        Show full secret values (use with caution)
  --project <dir> Project directory (default: cwd)
  --consumer <id> Consumer identity for audit trail
  --since <date>  Filter audit records since date
  --service <s>   Filter by service name
  --name <n>      Filter by secret name

Examples:
  kimi-secrets check
  kimi-secrets list --json
  kimi-secrets get database password
  kimi-secrets set database password --consumer api-server
  kimi-secrets audit --since 2026-01-01`;

// ── kimi-guardian Help ───────────────────────────────────────────────

export const kimiGuardianHelp = `kimi-guardian — Supply chain security CLI

${buildStamp}

Usage:
  kimi-guardian <command> [options]

Commands:
  check    Verify lockfile integrity, scan CVEs, check trusted deps (default)
  fix      Update baseline hash and apply trusted dependency fixes
  sign     Sign lockfile manifest with v2 signature
  verify   Verify v2 manifest signature
  report   Full P1 report: lockfile, CVEs, provenance, trusted deps
  doctor   Health check for guardian configuration

Options:
  --project <dir>  Project directory (default: cwd)
  --json           Output as JSON

Examples:
  kimi-guardian check
  kimi-guardian report --json
  kimi-guardian sign
  kimi-guardian doctor`;

// ── General Help ─────────────────────────────────────────────────────

export const generalHelp = `kimi-toolchain — Bun-native security and identity toolchain

${buildStamp}

Tools:
  kimi-secrets   Secret management (check, list, get, set, rotate, audit)
  kimi-guardian  Supply chain security (CVE scan, lockfile integrity, provenance)
  install-secure Secure install with vulnerability scanning and patching

Run any tool with --help for detailed usage.`;
