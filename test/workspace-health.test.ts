import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  auditWorkspaceHealth,
  countWorkspaceBlockers,
  isWorkspaceBlocker,
  listLegacyCursorSlugs,
  isCursorSlugActive,
  CANONICAL_REPO_NAME,
  WORKSPACE_BLOCKER_NAMES,
} from "../src/lib/workspace-health.ts";
import {
  removeLegacyCursorSlugs,
  archiveLegacyKimiSessions,
  pruneLegacySessionIndex,
} from "../src/bin/kimi-cleanup-legacy.ts";

const REPO_ROOT = import.meta.dir + "/..";
let tmpHome: string;

beforeEach(() => {
  tmpHome = join(tmpdir(), `ws-health-${Bun.randomUUIDv7()}`);
  mkdirSync(tmpHome, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true });
});

describe("workspace-health", () => {
  test("detects legacy Cursor slug as blocker when canonical clone present", async () => {
    const canonical = join(tmpHome, CANONICAL_REPO_NAME);
    mkdirSync(canonical, { recursive: true });
    writeFileSync(
      join(canonical, "package.json"),
      JSON.stringify({ name: CANONICAL_REPO_NAME, bin: {} }, null, 2)
    );

    const cursorProjects = join(tmpHome, ".cursor", "projects", "Users-test-kimicode-cli");
    mkdirSync(cursorProjects, { recursive: true });
    writeFileSync(join(cursorProjects, "state.json"), "{}");

    const report = await auditWorkspaceHealth(REPO_ROOT, { home: tmpHome });
    const cursorCheck = report.checks.find((c) => c.name === "cursor-workspace");
    expect(cursorCheck?.status).toBe("error");
    expect(listLegacyCursorSlugs(tmpHome)).toContain("Users-test-kimicode-cli");

    const summary = countWorkspaceBlockers(report);
    expect(summary.blocking).toBeGreaterThan(0);
    expect(isWorkspaceBlocker(cursorCheck!, { isToolchainRepo: true })).toBe(true);
  }, 10_000);

  test("reports missing wrappers as blocker", async () => {
    mkdirSync(join(tmpHome, ".local", "bin"), { recursive: true });
    mkdirSync(join(tmpHome, ".kimi-code", "tools"), { recursive: true });

    const report = await auditWorkspaceHealth(REPO_ROOT, { home: tmpHome });
    const wrapperCheck = report.checks.find((c) => c.name === "wrapper-coverage");
    expect(wrapperCheck?.status).toBe("error");
    expect(WORKSPACE_BLOCKER_NAMES.has("wrapper-coverage")).toBe(true);
  }, 10_000);

  test("strict mode promotes soft session warnings to blockers", async () => {
    const sessionsDir = join(tmpHome, ".kimi-code", "sessions", "wd_kimicode-cli_abc");
    mkdirSync(sessionsDir, { recursive: true });

    const report = await auditWorkspaceHealth(REPO_ROOT, { home: tmpHome });
    const loose = countWorkspaceBlockers(report);
    const strict = countWorkspaceBlockers(report, { strictWorkspace: true });
    expect(strict.blocking).toBeGreaterThanOrEqual(loose.blocking);
  }, 10_000);

  test("pruneLegacySessionIndex removes kimicode-cli cwd lines", () => {
    const sessionsDir = join(tmpHome, ".kimi-code", "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
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
    mkdirSync(legacy, { recursive: true });
    const archived = archiveLegacyKimiSessions(tmpHome);
    expect(archived).toContain("wd_kimicode-cli_abc");
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(join(tmpHome, ".kimi-code", "sessions", "archive"))).toBe(true);
  }, 5_000);

  test("isCursorSlugActive detects recent transcript mtime", () => {
    const slugPath = join(tmpHome, ".cursor", "projects", "Users-test-kimicode-cli");
    const transcripts = join(slugPath, "agent-transcripts");
    mkdirSync(transcripts, { recursive: true });
    writeFileSync(join(transcripts, "chat.jsonl"), "{}");
    expect(isCursorSlugActive(tmpHome, "Users-test-kimicode-cli")).toBe(true);
  }, 5_000);

  test("removeLegacyCursorSlugs deletes matching folders", async () => {
    const slugPath = join(tmpHome, ".cursor", "projects", "Users-nolarose-kimicode-cli");
    mkdirSync(slugPath, { recursive: true });
    writeFileSync(join(slugPath, "meta.json"), "{}");

    const removed = removeLegacyCursorSlugs(tmpHome);
    expect(removed).toContain("Users-nolarose-kimicode-cli");
    expect(existsSync(slugPath)).toBe(false);
  }, 5_000);
});
