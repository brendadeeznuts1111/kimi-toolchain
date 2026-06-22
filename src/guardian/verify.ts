#!/usr/bin/env bun
/**
 * Advisory lockfile wrapper around the synced runtime guardian.
 *
 * Invokes the synced runtime copy (~/.kimi-code/tools/kimi-guardian.ts) and parses
 * its output for hash mismatch strings. Exits 0 by default (advisory); use --exit-code
 * to force a non-zero exit on failure.
 *
 * Exit codes (--exit-code mode):
 *   0  — lockfile integrity verified
 *   2  — hash mismatch (taxonomy: lockfile_issue)
 *   3  — unsigned manifest, no key available
 *   4  — guardian runtime not found (needs sync)
 *
 * Pre-push hooks use hook-gates.ts + the repo binary instead.
 */

import { $ } from "bun";
import { join } from "path";
import { pathExists } from "../lib/bun-io.ts";
import { toolsDir } from "../lib/paths.ts";

const args = process.argv.slice(2);
const exitOnFail = args.includes("--exit-code");
const jsonMode = args.includes("--json");
const guardianPath = join(toolsDir(), "kimi-guardian.ts");

const EXIT_OK = 0;
const EXIT_HASH_MISMATCH = 2;
const EXIT_UNSIGNED_MANIFEST = 3;
const EXIT_GUARDIAN_MISSING = 4;

interface RemediationStep {
  command: string;
  description: string;
  category: "fix" | "verify" | "ci";
}

function buildRemediation(issues: string[]): RemediationStep[] {
  const steps: RemediationStep[] = [];

  if (issues.includes("hash")) {
    steps.push({
      command: "kimi-guardian fix",
      description: "Baseline the lockfile hash (trusted deps + install policy)",
      category: "fix",
    });
  }

  if (issues.includes("unsigned")) {
    steps.push({
      command: "kimi-guardian sign",
      description:
        "Create v2 signed manifest with HMAC (key in macOS Keychain or ~/.kimi-code/guardian/.key)",
      category: "fix",
    });
  }

  steps.push({
    command: "bun run test:parallel",
    description: "Verify across all CPUs after fix (Bun >=1.3.13, --isolate per file)",
    category: "verify",
  });
  steps.push({
    command: "bun run test:shard --shard=1/3",
    description: "CI matrix verification - split across 3 runners",
    category: "ci",
  });

  return steps;
}

function buildJsonOutput(valid: boolean, issues: string[], remediation: RemediationStep[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    tool: "guardian-verify",
    timestamp: new Date().toISOString(),
    valid,
    issues,
    taxonomyId: issues.length > 0 ? "lockfile_issue" : null,
    remediation: remediation.map((r) => ({
      command: r.command,
      description: r.description,
      category: r.category,
    })),
  });
}

export function evaluateGuardianVerifyOutput(
  output: string,
  exitOnFail: boolean
): { exitCode: number; lines: string[]; issues: string[] } {
  const lines = output.split("\n").filter((line) => line.trim().length > 0);
  const issues: string[] = [];

  const hashError = lines.some((line) => /HASH MISMATCH|No stored hash/i.test(line));
  const hasNoSignedManifest = lines.some((line) => /No signed manifest/i.test(line));
  const success = !hashError && (!hasNoSignedManifest || !exitOnFail);

  if (hashError) issues.push("hash");
  if (hasNoSignedManifest) issues.push("unsigned");

  const hintLines = buildHintLines(issues);

  if (success && issues.length === 0) {
    return {
      exitCode: EXIT_OK,
      lines: ["✓ Lockfile integrity verified"],
      issues: [],
    };
  }

  let exitCode = EXIT_OK;
  if (exitOnFail) {
    if (hashError) exitCode = EXIT_HASH_MISMATCH;
    else if (hasNoSignedManifest) exitCode = EXIT_UNSIGNED_MANIFEST;
  }

  return {
    exitCode,
    lines: hintLines,
    issues,
  };
}

function buildHintLines(issues: string[]): string[] {
  const lines: string[] = [];
  if (issues.includes("hash")) {
    lines.push("Run 'kimi-guardian fix' to baseline the hash");
  }
  if (issues.includes("unsigned")) {
    lines.push("Run 'kimi-guardian sign' for v2 signed manifest protection");
  }
  return lines;
}

if (import.meta.main) {
  if (!pathExists(guardianPath)) {
    const msg = "Guardian runtime not found — run 'bun run sync' first";
    if (jsonMode) {
      console.log(
        JSON.stringify({
          schemaVersion: 1,
          tool: "guardian-verify",
          valid: false,
          issues: ["guardian-missing"],
          remediation: [{ command: "bun run sync && bun run sync:verify", description: msg }],
        })
      );
    } else {
      console.error(msg);
    }
    process.exit(EXIT_GUARDIAN_MISSING);
  }

  const result = await $`bun run ${guardianPath} check`.nothrow().quiet();
  const output = [result.stdout.toString(), result.stderr.toString()].join("\n");
  const { exitCode, issues } = evaluateGuardianVerifyOutput(output, exitOnFail);

  if (issues.length > 0) {
    const remediation = buildRemediation(issues);

    if (jsonMode) {
      console.log(buildJsonOutput(false, issues, remediation));
    } else {
      console.log("⚠ Lockfile integrity issues detected:");
      for (const issue of issues) {
        console.log(`  - ${issue}`);
      }
      console.log("");
      console.log("Remediation:");
      for (const step of remediation) {
        console.log(`  [${step.category}] ${step.command}`);
        console.log(`          ${step.description}`);
      }
    }
  } else if (jsonMode) {
    console.log(buildJsonOutput(true, [], []));
  } else {
    console.log("✓ Lockfile integrity verified");
  }

  process.exit(exitCode);
}
