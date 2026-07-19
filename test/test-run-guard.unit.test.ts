import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, pathExists, removePath, writeText } from "../src/lib/bun-io.ts";
import {
  acquireTestGateLock,
  clearStaleTestGateLocks,
  resolveTestGateLockPath,
} from "../src/lib/test-run-guard.ts";
import { cleanupPath, testTempDir } from "./helpers.ts";

function lockDir(root: string): string {
  return resolveTestGateLockPath(root);
}

function cleanupRoot(root: string): void {
  removePath(lockDir(root), { recursive: true, force: true });
  removePath(root, { recursive: true, force: true });
}

describe("test-run-guard", () => {
  test("acquires and releases the project test gate lock", () => {
    const root = testTempDir("kimi-test-guard-");
    const acquired = acquireTestGateLock(root, "unit");
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    expect(pathExists(lockDir(root))).toBe(true);
    acquired.lock.release();
    expect(pathExists(lockDir(root))).toBe(false);
    cleanupRoot(root);
  });

  test("blocks a second live owner with a clear error", () => {
    const root = testTempDir("kimi-test-guard-live-");
    const dir = lockDir(root);
    makeDir(dir, { recursive: true });
    writeText(
      join(dir, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        ppid: process.ppid,
        projectRoot: root,
        command: "bun run check:fast",
        startedAt: "2026-06-18T00:00:00.000Z",
        reason: "test:fast",
      })
    );

    const acquired = acquireTestGateLock(root, "unit");
    expect(acquired.ok).toBe(false);
    if (acquired.ok) return;
    expect(acquired.conflict.message).toContain("another Bun test gate is already running");
    expect(acquired.conflict.message).toContain(`project: ${root}`);
    expect(acquired.conflict.message).toContain(`owner pid: ${process.pid}`);
    expect(acquired.conflict.message).toContain("KIMI_ALLOW_CONCURRENT_TESTS=1");
    cleanupRoot(root);
  });

  test("normalizes equivalent project root paths before locking", () => {
    const root = testTempDir("kimi-test-guard-normalize-");
    const acquired = acquireTestGateLock(join(root, "scripts", ".."), "unit");
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;

    const second = acquireTestGateLock(root, "unit");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.conflict.message).toContain(`project: ${root}`);
    }

    acquired.lock.release();
    cleanupRoot(root);
  });

  test("removes stale locks before acquiring", () => {
    const root = testTempDir("kimi-test-guard-stale-");
    const dir = lockDir(root);
    makeDir(dir, { recursive: true });
    writeText(
      join(dir, "owner.json"),
      JSON.stringify({
        pid: 99999999,
        ppid: 1,
        projectRoot: root,
        command: "bun run check:fast",
        startedAt: "2026-06-18T00:00:00.000Z",
        reason: "test:fast",
      })
    );

    const acquired = acquireTestGateLock(root, "unit");
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    expect(acquired.lock.owner.pid).toBe(process.pid);
    acquired.lock.release();
    cleanupRoot(root);
  });

  test("allows explicit concurrent test override", () => {
    const root = testTempDir("kimi-test-guard-override-");
    const previous = Bun.env.KIMI_ALLOW_CONCURRENT_TESTS;
    Bun.env.KIMI_ALLOW_CONCURRENT_TESTS = "1";
    try {
      const acquired = acquireTestGateLock(root, "unit");
      expect(acquired.ok).toBe(true);
      expect(pathExists(lockDir(root))).toBe(false);
    } finally {
      if (previous === undefined) delete Bun.env.KIMI_ALLOW_CONCURRENT_TESTS;
      else Bun.env.KIMI_ALLOW_CONCURRENT_TESTS = previous;
      cleanupRoot(root);
    }
  });

  test("clearStaleTestGateLocks removes dead-owner locks and keeps live ones", () => {
    const root = testTempDir("kimi-test-guard-clear-");
    const dir = lockDir(root);
    makeDir(dir, { recursive: true });

    // Dead owner (pid far outside valid range) → removed.
    writeText(
      join(dir, "owner.json"),
      JSON.stringify({
        pid: 99999999,
        ppid: 1,
        projectRoot: root,
        command: "bun run check:fast",
        startedAt: "2026-07-18T00:00:00.000Z",
        reason: "check:fast",
      })
    );
    // Live owner (this process) in a second lock dir → kept.
    const base = dir.slice(0, dir.lastIndexOf("/"));
    const liveDir = `${base}/aaaabbbbccccdddd-test-gate.lock`;
    makeDir(liveDir, { recursive: true });
    writeText(
      join(liveDir, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        ppid: process.ppid,
        projectRoot: root,
        command: "bun run test:fast",
        startedAt: "2026-07-18T00:00:00.000Z",
        reason: "test:fast",
      })
    );

    const removed = clearStaleTestGateLocks(root);
    expect(removed).toEqual([dir]);
    expect(pathExists(dir)).toBe(false);
    expect(pathExists(liveDir)).toBe(true);
    cleanupPath(root);
  });
});
