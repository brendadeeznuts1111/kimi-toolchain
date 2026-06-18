#!/usr/bin/env bun
import { pathExists } from "../lib/bun-io.ts";
/**
 * postinstall.ts — Idempotent setup of ~/.kimi-code/ from repo source
 * Runs on `bun install -g` or `bun install`
 */

import { join, resolve } from "path";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import {
  desktopRoot,
  AGENTS_SKILLS_ROOT,
  ensureDesktopLayout,
  syncDesktop,
} from "../lib/desktop-sync.ts";
import { DEFAULT_CONFIG_TEMPLATE } from "../lib/governor-config.ts";
import { SESSIONS_SCHEMA_SQL } from "../lib/sessions-schema.ts";
import { provisionUserMcp } from "../lib/mcp-config.ts";
import { readableStreamToText } from "../lib/bun-utils.ts";
import { withNoOrphansEnv } from "../lib/bun-spawn-env.ts";
import { ensureDir } from "../lib/utils.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const VAR_DIR = join(desktopRoot(), "var");
const GOVERNOR_DIR = join(desktopRoot(), "governor");

async function main(): Promise<number> {
  console.log("🔧 Setting up kimi-toolchain...");

  ensureDesktopLayout();

  const governorDefaults = join(GOVERNOR_DIR, "defaults.toml");
  if (!pathExists(governorDefaults)) {
    await Bun.write(governorDefaults, DEFAULT_CONFIG_TEMPLATE);
  }

  await syncDesktop(REPO_ROOT, { force: true });

  const mcp = await provisionUserMcp();
  console.log(
    mcp.changed ? "   MCP: unified-shell registered" : "   MCP: unified-shell already configured"
  );

  const dbPath = join(VAR_DIR, "sessions.db");
  if (!pathExists(dbPath)) {
    console.log("  🗄 Initializing sessions.db...");
    const db = new Database(dbPath, { create: true });
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SESSIONS_SCHEMA_SQL);
    db.close();
  }

  const wrapperScript = join(REPO_ROOT, "scripts", "install-bin-wrappers.sh");
  if (pathExists(wrapperScript)) {
    const proc = Bun.spawn(["bash", wrapperScript], {
      stdout: "pipe",
      stderr: "pipe",
      env: withNoOrphansEnv(),
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      console.log("   Wrappers: ~/.local/bin/kimi-*");
    } else {
      const err = await readableStreamToText(proc.stderr);
      console.warn(`  ⚠ Wrapper install failed: ${err.trim()}`);
    }
  }

  ensureDir(AGENTS_SKILLS_ROOT);
  console.log("   Skill: ~/.agents/skills/kimi-toolchain/");
  console.log(`   Skill: ${join(desktopRoot(), "skills/kimi-toolchain/")}`);
  console.log("✅ kimi-toolchain ready");
  console.log(`   Tools: ${join(desktopRoot(), "tools")}`);
  console.log(`   State: ${VAR_DIR}`);
  console.log(`   Docs:  ${join(desktopRoot())}/{AGENTS,UNIFIED,TEMPLATES}.md`);
  return 0;
}

(async () => {
  try {
    const exitCode = await Effect.runPromise(
      Effect.tryPromise({
        try: () => main(),
        catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
      })
    );
    process.exit(exitCode);
  } catch (err) {
    console.error("❌ Setup failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
})();
