#!/usr/bin/env bun
/**
 * postinstall.ts — Idempotent setup of ~/.kimi-code/ from repo source
 */

import { Effect } from "effect";
import { readableStreamToText } from "../lib/bun-utils.ts";
import { Database } from "bun:sqlite";
import { ensureDesktopLayout, syncDesktopEffect } from "../lib/desktop-sync.ts";
import { makeDir } from "../lib/bun-io.ts";
import { agentsSkillsRoot, canonicalRepoRoot, desktopRoot } from "../lib/paths.ts";
import { DEFAULT_CONFIG_TEMPLATE } from "../lib/governor-config.ts";
import { SESSIONS_SCHEMA_SQL } from "../lib/sessions-schema.ts";
import { provisionUserMcp } from "../lib/mcp-config.ts";
import { scrubProcessBunInstallCacheEnv } from "../lib/root-hygiene.ts";

scrubProcessBunInstallCacheEnv();

const REPO_ROOT = canonicalRepoRoot(import.meta.dir);
const VAR_DIR = `${desktopRoot()}/var`;
const GOVERNOR_DIR = `${desktopRoot()}/governor`;

async function main() {
  console.log("🔧 Setting up kimi-toolchain...");

  ensureDesktopLayout();

  const governorDefaults = `${GOVERNOR_DIR}/defaults.toml`;
  if (!(await Bun.file(governorDefaults).exists())) {
    await Bun.write(governorDefaults, DEFAULT_CONFIG_TEMPLATE);
  }

  await Effect.runPromise(syncDesktopEffect(REPO_ROOT, { force: true }));

  const mcp = await provisionUserMcp();
  console.log(
    mcp.changed ? "   MCP: unified-shell registered" : "   MCP: unified-shell already configured"
  );

  const dbPath = `${VAR_DIR}/sessions.db`;
  if (!(await Bun.file(dbPath).exists())) {
    console.log("  🗄 Initializing sessions.db...");
    using db = new Database(dbPath, { create: true });
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SESSIONS_SCHEMA_SQL);
  }

  const wrapperScript = `${REPO_ROOT}/scripts/install-bin-wrappers.sh`;
  if (await Bun.file(wrapperScript).exists()) {
    const proc = Bun.spawn(["bash", wrapperScript], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      console.log("   Wrappers: ~/.local/bin/kimi-*");
    } else {
      const err = await readableStreamToText(proc.stderr);
      console.warn(`  ⚠ Wrapper install failed: ${err.trim()}`);
    }
  }

  makeDir(agentsSkillsRoot(), { recursive: true });
  console.log("   Skill: ~/.agents/skills/kimi-toolchain/");
  console.log(`   Skill: ${desktopRoot()}/skills/kimi-toolchain/`);
  console.log("✅ kimi-toolchain ready");
  console.log(`   Tools: ${desktopRoot()}/tools`);
  console.log(`   State: ${VAR_DIR}`);
  console.log(`   Docs:  ${desktopRoot()}/{AGENTS,UNIFIED,TEMPLATES}.md`);
}

try {
  await main();
} catch (err) {
  console.error("❌ Setup failed:", (err as Error).message);
  process.exit(1);
}
