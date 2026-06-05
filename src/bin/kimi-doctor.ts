#!/usr/bin/env bun
/**
 * kimi-doctor — Comprehensive diagnostics
 * Delegates to individual tool doctor commands + runs system checks
 * Usage: kimi-doctor [--fix]
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";

const TOOLS_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "tools");
const FIX = Bun.argv.includes("--fix");

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

function ok(name: string, message: string): CheckResult {
  console.log(`  ✓ ${name}: ${message}`);
  return { name, status: "ok", message };
}

function warn(name: string, message: string): CheckResult {
  console.log(`  ⚠ ${name}: ${message}`);
  return { name, status: "warn", message };
}

function error(name: string, message: string): CheckResult {
  console.log(`  ✗ ${name}: ${message}`);
  return { name, status: "error", message };
}

function section(title: string) {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

async function runToolDoctor(tool: string): Promise<CheckResult> {
  const path = join(TOOLS_DIR, `${tool}.ts`);
  if (!existsSync(path)) {
    return error(tool, `not found at ${path}`);
  }

  const cmd = FIX ? "fix" : "doctor";
  console.log(`  → Running ${tool} ${cmd}...`);

  try {
    const proc = Bun.spawn(["bun", "run", path, cmd], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await Bun.readableStreamToText(proc.stdout);
    const stderr = await Bun.readableStreamToText(proc.stderr);

    // Print output indented
    for (const line of stdout.split("\n")) {
      if (line.trim()) console.log(`    ${line}`);
    }
    for (const line of stderr.split("\n")) {
      if (line.trim()) console.log(`    ${line}`);
    }

    if (exitCode === 0) {
      return ok(tool, `${cmd} passed`);
    } else {
      return error(tool, `${cmd} found problems (exit ${exitCode})`);
    }
  } catch (e: any) {
    return error(tool, `failed: ${e.message}`);
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║           Kimi Doctor — Comprehensive Diagnostics            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  const results: CheckResult[] = [];

  // ── System ──
  section("System");

  // Disk usage
  try {
    const df = await $`df /`.quiet();
    const line = df.stdout.toString().split("\n")[1];
    const used = parseInt(line?.trim().split(/\s+/)[4]?.replace("%", "") || "0");
    if (used > 90) results.push(error("disk", `${used}% (critical)`));
    else if (used > 80) results.push(warn("disk", `${used}% (high)`));
    else results.push(ok("disk", `${used}%`));
  } catch {
    results.push(warn("disk", "could not check"));
  }

  // Memory
  try {
    const vmstat = await $`vm_stat`.quiet();
    const freeMatch = vmstat.stdout.toString().match(/Pages free:\s*(\d+)/);
    const freePages = parseInt(freeMatch?.[1] || "0");
    const freeMB = Math.round((freePages * 16384) / 1024 / 1024);
    if (freeMB < 500) results.push(warn("memory", `~${freeMB}MB free (low)`));
    else results.push(ok("memory", `~${freeMB}MB free`));
  } catch {
    results.push(warn("memory", "could not check"));
  }

  // Load
  try {
    const uptime = await $`uptime`.quiet();
    const loadMatch = uptime.stdout.toString().match(/load averages?:\s*([\d.]+)/);
    const load = parseFloat(loadMatch?.[1] || "0");
    if (load > 10) results.push(warn("load", `${load} (high)`));
    else results.push(ok("load", `${load}`));
  } catch {
    results.push(warn("load", "could not check"));
  }

  // ── Kimi Products ──
  section("Kimi Products");

  const kimiPath = Bun.which("kimi");
  if (kimiPath) {
    try {
      const version = await $`kimi --version`.quiet();
      results.push(ok("kimi-cli", version.stdout.toString().trim()));
    } catch {
      results.push(ok("kimi-cli", "installed"));
    }
  } else {
    results.push(error("kimi-cli", "not found"));
  }

  // ── Toolchain Health ──
  section("Toolchain Health");

  const tools = [
    "kimi-guardian",
    "kimi-governance",
    "kimi-context-gen",
    "kimi-memory",
    "kimi-resource-governor",
    "kimi-debug",
    "kimi-snapshot",
    "kimi-release",
    "kimi-githooks",
  ];

  for (const tool of tools) {
    results.push(await runToolDoctor(tool));
  }

  // ── Global Context ──
  section("Global Context");

  const home = Bun.env.HOME || "/tmp";
  results.push(existsSync(join(home, ".kimi-code", "AGENTS.md")) ? ok("AGENTS.md", "present") : error("AGENTS.md", "missing"));
  results.push(existsSync(join(home, ".kimi-code", "UNIFIED.md")) ? ok("UNIFIED.md", "present") : error("UNIFIED.md", "missing"));
  results.push(existsSync(join(home, ".kimi-code", "TEMPLATES.md")) ? ok("TEMPLATES.md", "present") : warn("TEMPLATES.md", "missing"));

  // ── PATH ──
  section("PATH");

  const pathEntries = (Bun.env.PATH || "").split(":");
  const kimiIdx = pathEntries.findIndex((p) => p.includes("kimi-code"));
  const bunIdx = pathEntries.findIndex((p) => p.includes(".bun/bin"));

  results.push(kimiIdx === 0 ? ok("kimi-code/bin", "#1 in PATH") : warn("kimi-code/bin", `#${kimiIdx + 1} in PATH`));
  results.push(bunIdx === 1 ? ok("bun/bin", "#2 in PATH") : warn("bun/bin", `#${bunIdx + 1} in PATH`));

  // ── Legacy ──
  section("Legacy");
  results.push(existsSync(join(home, ".kimi")) ? warn("~/.kimi", "deprecated — migrate to ~/.kimi-code/") : ok("~/.kimi", "gone"));

  // ── Node Ecosystem ──
  section("Node Ecosystem");

  const bunPath = Bun.which("bun");
  results.push(bunPath ? ok("bun", Bun.version) : error("bun", "not found"));

  for (const cmd of ["node", "npm", "pnpm", "yarn"]) {
    const p = Bun.which(cmd);
    if (p) {
      try {
        const proc = Bun.spawn([cmd, "--version"], { stdout: "pipe", stderr: "pipe" });
        const out = await Bun.readableStreamToText(proc.stdout);
        results.push(ok(cmd, out.trim()));
      } catch {
        results.push(ok(cmd, "installed"));
      }
    } else {
      console.log(`  ○ ${cmd}: not installed`);
    }
  }

  // ── Summary ──
  section("Summary");

  const errors = results.filter((r) => r.status === "error").length;
  const warnings = results.filter((r) => r.status === "warn").length;

  if (errors > 0) {
    console.log(`  ✗ ${errors} issue(s) found`);
  } else if (warnings > 0) {
    console.log(`  ⚠ ${warnings} warning(s) found`);
  } else {
    console.log("  ✓ All checks passed");
  }

  if (FIX) {
    console.log("  Auto-fix applied where possible.");
  } else {
    console.log("  Run with --fix to apply tool fixes.");
  }
}

main().catch((err) => {
  console.error("Doctor failed:", err.message);
  process.exit(1);
});
