#!/usr/bin/env bun
/**
 * postinstall.ts — Idempotent setup of ~/.kimi-code/ from repo source
 * Runs on `bun install -g` or `bun install`
 */

import { existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const KIMI_DIR = join(homedir(), ".kimi-code");
const TOOLS_DIR = join(KIMI_DIR, "tools");
const VAR_DIR = join(KIMI_DIR, "var");
const MEMORY_DIR = join(KIMI_DIR, "memory");
const GUARDIAN_DIR = join(KIMI_DIR, "guardian");
const GOVERNOR_DIR = join(KIMI_DIR, "governor");
const AGENTS_SKILLS_DIR = join(homedir(), ".agents", "skills");

const REPO_ROOT = resolve(import.meta.dir, "../..");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function copyFile(src: string, dest: string, overwrite = false) {
  if (!overwrite && existsSync(dest)) return;
  try {
    await Bun.write(dest, await Bun.file(src).text());
  } catch (e: any) {
    console.warn(`  ⚠ Could not copy ${src}: ${e.message}`);
  }
}

async function main() {
  console.log("🔧 Setting up kimi-toolchain...");

  // Create directory structure
  ensureDir(TOOLS_DIR);
  ensureDir(VAR_DIR);
  ensureDir(MEMORY_DIR);
  ensureDir(GUARDIAN_DIR);
  ensureDir(GOVERNOR_DIR);

  // Copy bin tools → ~/.kimi-code/tools/
  const binDir = join(REPO_ROOT, "src", "bin");
  for await (const entry of new Bun.Glob("*.ts").scan(binDir)) {
    const src = join(binDir, entry);
    const dest = join(TOOLS_DIR, entry);
    await copyFile(src, dest, true);
  }

  // Copy lib → ~/.kimi-code/lib/
  const libDir = join(REPO_ROOT, "src", "lib");
  const libDestDir = join(KIMI_DIR, "lib");
  ensureDir(libDestDir);
  for await (const entry of new Bun.Glob("*.ts").scan(libDir)) {
    const src = join(libDir, entry);
    const dest = join(libDestDir, entry);
    await copyFile(src, dest, true);
  }

  const governorDefaults = join(GOVERNOR_DIR, "defaults.toml");
  if (!existsSync(governorDefaults)) {
    const { DEFAULT_CONFIG_TEMPLATE } = await import("../lib/governor-config.ts");
    await Bun.write(governorDefaults, DEFAULT_CONFIG_TEMPLATE);
  }

  // Copy templates → ~/.kimi-code/
  const templates = ["AGENTS.md", "UNIFIED.md", "TEMPLATES.md"];
  for (const file of templates) {
    const src = join(REPO_ROOT, file);
    const dest = join(KIMI_DIR, file);
    if (existsSync(src)) {
      await copyFile(src, dest, true);
    }
  }

  // Copy config files
  const configFiles = ["bunfig.toml", ".gitignore"];
  for (const file of configFiles) {
    const src = join(REPO_ROOT, file);
    const dest = join(KIMI_DIR, file);
    if (existsSync(src)) {
      await copyFile(src, dest, false); // Don't overwrite user configs
    }
  }

  // Ensure var/sessions.db exists (but don't overwrite)
  const dbPath = join(VAR_DIR, "sessions.db");
  if (!existsSync(dbPath)) {
    console.log("  🗄 Initializing sessions.db...");
    const { Database } = await import("bun:sqlite");
    const db = new Database(dbPath, { create: true });
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        cwd TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        last_cmd TEXT DEFAULT '',
        cmd_history TEXT DEFAULT '[]',
        env_snapshot TEXT DEFAULT '{}',
        git_head TEXT DEFAULT '',
        lockfile_hash TEXT DEFAULT '',
        context_size INTEGER DEFAULT 0,
        key_decisions TEXT DEFAULT '[]',
        status TEXT DEFAULT 'active'
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
      CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

      CREATE TABLE IF NOT EXISTS knowledge_nodes (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        project TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_project ON knowledge_nodes(project);
      CREATE INDEX IF NOT EXISTS idx_nodes_type ON knowledge_nodes(type);

      CREATE TABLE IF NOT EXISTS knowledge_edges (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        PRIMARY KEY (from_id, to_id, relation)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_from ON knowledge_edges(from_id);
      CREATE INDEX IF NOT EXISTS idx_edges_to ON knowledge_edges(to_id);

      CREATE TABLE IF NOT EXISTS doctor_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        tool TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        r_score REAL,
        git_head TEXT,
        project TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_doctor_runs_project ON doctor_runs(project);
      CREATE INDEX IF NOT EXISTS idx_doctor_runs_tool ON doctor_runs(tool);

      CREATE TABLE IF NOT EXISTS warning_trends (
        check_name TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        occurrence_count INTEGER DEFAULT 1,
        resolved_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_warning_trends_tool ON warning_trends(tool);
      CREATE INDEX IF NOT EXISTS idx_warning_trends_resolved ON warning_trends(resolved_at);
    `);
    db.close();
  }

  // Copy skill to agent skills directory
  const skillSrc = join(REPO_ROOT, "skills", "kimi-toolchain");
  const skillDest = join(AGENTS_SKILLS_DIR, "kimi-toolchain");
  if (existsSync(skillSrc)) {
    ensureDir(AGENTS_SKILLS_DIR);
    await copyFile(join(skillSrc, "SKILL.md"), join(skillDest, "SKILL.md"), true);
    console.log("   Skill: ~/.agents/skills/kimi-toolchain/");
  }

  // Install thin PATH wrappers (~/.local/bin/kimi-*)
  const wrapperScript = join(REPO_ROOT, "scripts", "install-bin-wrappers.sh");
  if (existsSync(wrapperScript)) {
    const proc = Bun.spawn(["bash", wrapperScript], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      console.log("   Wrappers: ~/.local/bin/kimi-*");
    } else {
      const err = await Bun.readableStreamToText(proc.stderr);
      console.warn(`  ⚠ Wrapper install failed: ${err.trim()}`);
    }
  }

  console.log("✅ kimi-toolchain ready");
  console.log(`   Tools: ${TOOLS_DIR}`);
  console.log(`   State: ${VAR_DIR}`);
  console.log(`   Docs:  ${KIMI_DIR}/{AGENTS,UNIFIED,TEMPLATES}.md`);
}

main().catch((err) => {
  console.error("❌ Setup failed:", err.message);
  process.exit(1);
});
