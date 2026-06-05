#!/usr/bin/env bun
/**
 * kimi-doctor — Comprehensive diagnostics
 * Delegates to individual tool doctor commands + runs system checks
 * Usage: kimi-doctor [--fix] [--quick] [--memory-budget]
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { basename, join } from "path";
import {
  TOOLCHAIN_VERSION,
  getDesktopVersion,
  getRepoHead,
  hasUncommittedChanges,
  readManifest,
} from "../lib/version.ts";
import {
  runSystemMemoryChecks,
  printMemoryBudget,
  type MemoryCheckResult,
} from "../lib/memory-budget.ts";
import { getOrphanProcesses, runOrphanKill } from "./kimi-orphan-kill.ts";
import { resolveProjectRoot } from "../lib/utils.ts";

const TOOLS_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "tools");
const FIX = Bun.argv.includes("--fix");
const QUICK = Bun.argv.includes("--quick");
const MEMORY_BUDGET = Bun.argv.includes("--memory-budget");

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

function recordMemoryCheck(r: MemoryCheckResult): CheckResult {
  const icon = r.status === "ok" ? "✓" : r.status === "warn" ? "⚠" : "✗";
  console.log(`  ${icon} ${r.name}: ${r.message}`);
  return { name: r.name, status: r.status, message: r.message };
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

async function versionMatrix(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const [desktopVersion, repoHead, dirty, manifest] = await Promise.all([
    getDesktopVersion(),
    getRepoHead(),
    hasUncommittedChanges(),
    readManifest(),
  ]);

  const desktopLabel = desktopVersion ?? "unknown";
  const repoLabel = repoHead ?? "unknown";

  if (desktopVersion) {
    results.push(ok("Desktop (kimi)", desktopLabel));
  } else {
    results.push(error("Desktop (kimi)", "not found"));
  }

  results.push(ok("Toolchain", `${TOOLCHAIN_VERSION} (${repoLabel})`));
  results.push(ok("MCP Bridge", TOOLCHAIN_VERSION));

  if (manifest) {
    const synced = manifest.gitHead === repoHead && !dirty;
    const syncLabel = `${manifest.lastSyncedAt.slice(0, 19).replace("T", " ")} UTC`;
    if (synced) {
      results.push(ok("Last sync", syncLabel));
    } else if (dirty) {
      results.push(warn("Last sync", `${syncLabel} — repo has uncommitted changes`));
    } else {
      results.push(warn("Last sync", `${syncLabel} — repo HEAD (${repoLabel}) differs from sync`));
    }
  } else {
    results.push(warn("Last sync", "never — run `bun run sync`"));
  }

  if (dirty) {
    results.push(warn("Working tree", "uncommitted changes present"));
  }

  const toolsDir = import.meta.dir;
  const runtimeTools = join(Bun.env.HOME || "/tmp", ".kimi-code", "tools");
  if (toolsDir.startsWith(runtimeTools)) {
    results.push(ok("Runtime", "synced copy in ~/.kimi-code/tools/"));
  } else {
    const repoDir = basename(join(toolsDir, "..", ".."));
    if (repoDir === "kimi-toolchain") {
      results.push(ok("Repo folder", repoDir));
    } else {
      results.push(warn("Repo folder", `${repoDir} — rename to kimi-toolchain for alignment`));
    }
  }

  return results;
}

async function runScript(projectRoot: string, script: string, label: string): Promise<CheckResult> {
  try {
    const proc = Bun.spawn(["bun", "run", script], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) return ok(label, "passed");
    const stderr = await Bun.readableStreamToText(proc.stderr);
    const detail =
      stderr
        .split("\n")
        .find((l) => l.trim())
        ?.slice(0, 80) || `exit ${exitCode}`;
    return error(label, detail);
  } catch (e: any) {
    return error(label, e.message);
  }
}

async function runQualityChecks(projectRoot: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return [warn("quality", "no package.json in project root")];
  }

  results.push(
    existsSync(join(projectRoot, ".oxfmtrc.json"))
      ? ok("oxfmtrc", "present")
      : warn("oxfmtrc", "missing — run kimi-fix")
  );
  results.push(
    existsSync(join(projectRoot, ".oxlintrc.json"))
      ? ok("oxlintrc", "present")
      : warn("oxlintrc", "missing — run kimi-fix")
  );

  const pkg = (await Bun.file(pkgPath).json()) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts || {};

  if (!scripts["format:check"]) {
    results.push(warn("format:check", "script not defined"));
  } else if (!QUICK) {
    results.push(await runScript(projectRoot, "format:check", "format:check"));
  }

  if (!scripts.lint) {
    results.push(warn("lint", "script not defined"));
  } else if (!QUICK) {
    results.push(await runScript(projectRoot, "lint", "lint"));
  }

  if (scripts.check) {
    results.push(ok("check", "composite script defined"));
  } else {
    results.push(warn("check", "script not defined — add format:check && lint && test"));
  }

  return results;
}

async function applyFixes(): Promise<void> {
  section("Auto-fix");
  const orphans = getOrphanProcesses();
  if (orphans.length > 0) {
    console.log(`  → Killing ${orphans.length} orphan process(es)...`);
    const { killed } = await runOrphanKill(false);
    console.log(`  ✓ Killed ${killed} orphan process(es)`);
  } else {
    console.log("  ✓ No orphan processes to kill");
  }

  const govPath = join(TOOLS_DIR, "kimi-resource-governor.ts");
  if (existsSync(govPath)) {
    console.log("  → Running kimi-resource-governor fix...");
    const proc = Bun.spawn(["bun", "run", govPath, "fix"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
  }
}

async function main() {
  if (MEMORY_BUDGET) {
    printMemoryBudget();
    process.exit(0);
  }

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║           Kimi Doctor — Comprehensive Diagnostics            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  const results: CheckResult[] = [];

  section("System");

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

  const memoryChecks = await runSystemMemoryChecks();
  for (const check of memoryChecks) {
    results.push(recordMemoryCheck(check));
  }

  section("Kimi Products");

  const kimiPath = Bun.which("kimi");
  if (kimiPath) {
    try {
      const version = await $`kimi --version`.quiet();
      results.push(ok("kimi-code", `${version.stdout.toString().trim()} (${kimiPath})`));
    } catch {
      results.push(ok("kimi-code", `installed (${kimiPath})`));
    }
  } else {
    results.push(
      error("kimi-code", "not found — curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash")
    );
  }

  section("Version Matrix");
  results.push(...(await versionMatrix()));

  section("Code Quality");
  const projectRoot = await resolveProjectRoot();
  results.push(...(await runQualityChecks(projectRoot)));
  if (QUICK) {
    console.log("  ⚡ Quick mode — config checks only; run without --quick to execute gates.");
  }

  section("Toolchain Health");

  if (QUICK) {
    console.log("  ⚡ Quick mode — skipping individual tool doctors.");
    console.log("     Run without --quick for full toolchain health check.");
  } else {
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
  }

  section("Global Context");

  const home = Bun.env.HOME || "/tmp";
  results.push(
    existsSync(join(home, ".kimi-code", "AGENTS.md"))
      ? ok("AGENTS.md", "present")
      : error("AGENTS.md", "missing")
  );
  results.push(
    existsSync(join(home, ".kimi-code", "UNIFIED.md"))
      ? ok("UNIFIED.md", "present")
      : error("UNIFIED.md", "missing")
  );
  results.push(
    existsSync(join(home, ".kimi-code", "TEMPLATES.md"))
      ? ok("TEMPLATES.md", "present")
      : warn("TEMPLATES.md", "missing")
  );

  section("PATH");

  const pathEntries = (Bun.env.PATH || "").split(":");
  const kimiIdx = pathEntries.findIndex((p) => p.includes("kimi-code"));
  const bunIdx = pathEntries.findIndex((p) => p.includes(".bun/bin"));

  results.push(
    kimiIdx === 0
      ? ok("kimi-code/bin", "#1 in PATH")
      : warn("kimi-code/bin", `#${kimiIdx + 1} in PATH`)
  );
  results.push(
    bunIdx === 1 ? ok("bun/bin", "#2 in PATH") : warn("bun/bin", `#${bunIdx + 1} in PATH`)
  );

  section("Legacy");
  results.push(
    existsSync(join(home, ".kimi"))
      ? warn("~/.kimi", "deprecated — run: kimi migrate")
      : ok("~/.kimi", "gone")
  );
  results.push(
    existsSync(join(home, ".kimi-code", "bin", "kimi.bak"))
      ? warn("kimi.bak", "stale upgrade backup — safe to delete")
      : ok("kimi.bak", "gone")
  );

  const doctorPath = Bun.which("kimi-doctor");
  if (doctorPath?.includes(".local/bin")) {
    try {
      const head = await Bun.file(doctorPath).text();
      if (head.includes(".kimi-code/tools/kimi-doctor.ts")) {
        results.push(ok("kimi-doctor wrapper", "thin exec → ~/.kimi-code/tools/"));
      } else {
        results.push(
          warn("kimi-doctor wrapper", "legacy bash script — run: bun run install-wrappers")
        );
      }
    } catch {
      results.push(warn("kimi-doctor wrapper", "could not read"));
    }
  }

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

  if (FIX) {
    await applyFixes();
  }

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
  } else if (QUICK) {
    console.log("  Quick mode — run without --quick for full check.");
  } else {
    console.log("  Run with --fix to apply tool fixes, --quick to skip tool doctors.");
  }
  console.log("  Run with --memory-budget to print per-app RSS breakdown.");

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Doctor failed:", err.message);
  process.exit(1);
});
