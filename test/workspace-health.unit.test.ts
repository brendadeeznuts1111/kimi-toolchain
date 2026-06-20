import { makeDir, pathExists, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { REPO_ROOT, testTempDir } from "./helpers.ts";
import {
  auditWorkspaceHealth,
  countWorkspaceBlockers,
  isWorkspaceBlocker,
  CANONICAL_REPO_NAME,
  WORKSPACE_BLOCKER_NAMES,
  CURSOR_EPHEMERAL_WORKTREE_RE,
  resolveEffectiveWorkspaceRoot,
} from "../src/lib/workspace-health.ts";
import {
  removeLegacyCursorSlugs,
  archiveLegacyKimiSessions,
  pruneLegacySessionIndex,
  listLegacyCursorSlugs,
  isCursorSlugActive,
} from "../src/lib/legacy-cleanup.ts";

let tmpHome: string;

beforeEach(() => {
  tmpHome = testTempDir("ws-health-");
  makeDir(tmpHome, { recursive: true });
});

afterEach(() => {
  if (pathExists(tmpHome)) removePath(tmpHome, { recursive: true, force: true });
});

describe("workspace-health", () => {
  test("detects legacy Cursor slug as blocker when canonical clone present", async () => {
    const canonical = join(tmpHome, CANONICAL_REPO_NAME);
    makeDir(canonical, { recursive: true });
    writeText(
      join(canonical, "package.json"),
      JSON.stringify({ name: CANONICAL_REPO_NAME, bin: {} }, null, 2)
    );

    const cursorProjects = join(tmpHome, ".cursor", "projects", "Users-test-kimicode-cli");
    makeDir(cursorProjects, { recursive: true });
    writeText(join(cursorProjects, "state.json"), "{}");

    const report = await auditWorkspaceHealth(REPO_ROOT, { home: tmpHome });
    const cursorCheck = report.checks.find((c) => c.name === "cursor-workspace");
    expect(cursorCheck?.status).toBe("error");
    expect(listLegacyCursorSlugs(tmpHome)).toContain("Users-test-kimicode-cli");

    const summary = countWorkspaceBlockers(report);
    expect(summary.blocking).toBeGreaterThan(0);
    expect(isWorkspaceBlocker(cursorCheck!, { isToolchainRepo: true })).toBe(true);
  }, 10_000);

  test("reports missing wrappers as blocker", async () => {
    makeDir(join(tmpHome, ".local", "bin"), { recursive: true });
    makeDir(join(tmpHome, ".kimi-code", "tools"), { recursive: true });

    const report = await auditWorkspaceHealth(REPO_ROOT, { home: tmpHome });
    const wrapperCheck = report.checks.find((c) => c.name === "wrapper-coverage");
    expect(wrapperCheck?.status).toBe("error");
    expect(WORKSPACE_BLOCKER_NAMES.has("wrapper-coverage")).toBe(true);
  }, 10_000);

  test("strict mode promotes soft session warnings to blockers", async () => {
    const sessionsDir = join(tmpHome, ".kimi-code", "sessions", "wd_kimicode-cli_abc");
    makeDir(sessionsDir, { recursive: true });

    const report = await auditWorkspaceHealth(REPO_ROOT, { home: tmpHome });
    const loose = countWorkspaceBlockers(report);
    const strict = countWorkspaceBlockers(report, { strictWorkspace: true });
    expect(strict.blocking).toBeGreaterThanOrEqual(loose.blocking);
  }, 10_000);

  test("pruneLegacySessionIndex removes kimicode-cli cwd lines", () => {
    const sessionsDir = join(tmpHome, ".kimi-code", "sessions");
    makeDir(sessionsDir, { recursive: true });
    writeText(
      join(sessionsDir, "session_index.jsonl"),
      [
        JSON.stringify({ workDir: "/Users/x/kimicode-cli" }),
        JSON.stringify({ workDir: "/Users/x/kimi-toolchain" }),
      ].join("\n") + "\n"
    );
    const pruned = pruneLegacySessionIndex(tmpHome);
    expect(pruned).toBe(1);
    const text = Bun.file(join(sessionsDir, "session_index.jsonl")).text();
    return text.then((t) => expect(t).toContain("kimi-toolchain"));
  }, 5_000);

  test("archiveLegacyKimiSessions moves wd_kimicode-cli_* to archive", () => {
    const legacy = join(tmpHome, ".kimi-code", "sessions", "wd_kimicode-cli_abc");
    makeDir(legacy, { recursive: true });
    const archived = archiveLegacyKimiSessions(tmpHome);
    expect(archived).toContain("wd_kimicode-cli_abc");
    expect(pathExists(legacy)).toBe(false);
    expect(pathExists(join(tmpHome, ".kimi-code", "sessions", "archive"))).toBe(true);
  }, 5_000);

  test("isCursorSlugActive detects recent transcript mtime", () => {
    const slugPath = join(tmpHome, ".cursor", "projects", "Users-test-kimicode-cli");
    const transcripts = join(slugPath, "agent-transcripts");
    makeDir(transcripts, { recursive: true });
    writeText(join(transcripts, "chat.jsonl"), "{}");
    expect(isCursorSlugActive("Users-test-kimicode-cli", undefined, tmpHome)).toBe(true);
  }, 5_000);

  test("removeLegacyCursorSlugs deletes matching folders", async () => {
    const slugPath = join(tmpHome, ".cursor", "projects", "Users-nolarose-kimicode-cli");
    makeDir(slugPath, { recursive: true });
    writeText(join(slugPath, "meta.json"), "{}");

    const removed = removeLegacyCursorSlugs(tmpHome);
    expect(removed).toContain("Users-nolarose-kimicode-cli");
    expect(pathExists(slugPath)).toBe(false);
  }, 5_000);

  test("CURSOR_EPHEMERAL_WORKTREE_RE matches known Cursor temp worktree paths", () => {
    expect(CURSOR_EPHEMERAL_WORKTREE_RE.test("/var/folders/wt-match--abc/kimi-toolchain")).toBe(
      true
    );
    expect(CURSOR_EPHEMERAL_WORKTREE_RE.test("/Users/x/.codex/worktrees/kimi-toolchain")).toBe(
      true
    );
    expect(CURSOR_EPHEMERAL_WORKTREE_RE.test("/Users/x/kimi-toolchain")).toBe(false);
  });

  test("resolveEffectiveWorkspaceRoot uses cwd when package.json is present", () => {
    const result = resolveEffectiveWorkspaceRoot(REPO_ROOT, tmpHome);
    expect(result.root).toBe(REPO_ROOT);
    expect(result.usedFallback).toBe(false);
  });

  test("resolveEffectiveWorkspaceRoot falls back to canonical clone when cwd lacks package.json", () => {
    const canonical = join(tmpHome, CANONICAL_REPO_NAME);
    makeDir(canonical, { recursive: true });
    writeText(
      join(canonical, "package.json"),
      JSON.stringify({ name: CANONICAL_REPO_NAME }, null, 2)
    );

    const orphanCwd = join(tmpHome, "orphan-cwd");
    makeDir(orphanCwd, { recursive: true });

    const result = resolveEffectiveWorkspaceRoot(orphanCwd, tmpHome);
    expect(result.root).toBe(canonical);
    expect(result.usedFallback).toBe(true);
    expect(result.reason).toBe("missing-package-json");
  });

  test("resolveEffectiveWorkspaceRoot stays on cwd when no canonical clone exists", () => {
    const orphanCwd = join(tmpHome, "no-canonical");
    makeDir(orphanCwd, { recursive: true });

    const result = resolveEffectiveWorkspaceRoot(orphanCwd, tmpHome);
    expect(result.root).toBe(orphanCwd);
    expect(result.usedFallback).toBe(false);
  });
});
