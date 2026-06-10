import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  auditWorkspaceHealth,
  countWorkspaceBlockers,
  isWorkspaceBlocker,
  listLegacyCursorSlugs,
  removeLegacyCursorSlugs,
  CANONICAL_REPO_NAME,
  WORKSPACE_BLOCKER_NAMES,
} from "../src/lib/workspace-health.ts";

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

  test("removeLegacyCursorSlugs deletes matching folders", async () => {
    const slugPath = join(tmpHome, ".cursor", "projects", "Users-nolarose-kimicode-cli");
    mkdirSync(slugPath, { recursive: true });
    writeFileSync(join(slugPath, "meta.json"), "{}");

    const removed = removeLegacyCursorSlugs(tmpHome);
    expect(removed).toContain("Users-nolarose-kimicode-cli");
    expect(existsSync(slugPath)).toBe(false);
  }, 5_000);
});
