/**
 * Project-scoped guard for expensive Bun test gates.
 *
 * The lock is owned by the wrapper process, not the child `bun test`, so it
 * survives quiet/verbose runner variants and is released when the wrapper ends.
 */

import { makeDir, pathExists, readText, removePath, writeText, listDir } from "./bun-io.ts";

const LOCK_DIR_NAME = "test-gate.lock";
const OWNER_FILE = "owner.json";

export interface TestGateOwner {
  pid: number;
  ppid: number;
  projectRoot: string;
  command: string;
  startedAt: string;
  reason: string;
}

export interface TestGateLock {
  path: string;
  owner: TestGateOwner;
  release: () => void;
}

export interface TestGateConflict {
  path: string;
  owner: TestGateOwner;
  message: string;
}

export type TestGateAcquireResult =
  | { ok: true; lock: TestGateLock }
  | { ok: false; conflict: TestGateConflict };

export function resolveTestGateLockPath(projectRoot: string): string {
  const absolute = projectRoot.startsWith("/") ? projectRoot : `${process.cwd()}/${projectRoot}`;
  // Strip trailing slashes so every entry point to the same repo shares one lock.
  const normalized = absolute.replace(/\/+$/, "") || "/";
  const hash = new Bun.CryptoHasher("sha256").update(normalized).digest("hex").slice(0, 16);
  const base = Bun.env.KIMI_TEST_LOCK_DIR ?? `${normalized}/.kimi-test-locks`;
  return `${base}/${hash}-${LOCK_DIR_NAME}`;
}

function currentCommand(): string {
  return [Bun.argv[0], ...Bun.argv.slice(1)].filter(Boolean).join(" ");
}

function parseOwner(path: string): TestGateOwner | null {
  try {
    const raw = JSON.parse(readText(`${path}/${OWNER_FILE}`)) as Partial<TestGateOwner>;
    if (typeof raw.pid !== "number" || raw.pid <= 0) return null;
    return {
      pid: raw.pid,
      ppid: typeof raw.ppid === "number" ? raw.ppid : 0,
      projectRoot: String(raw.projectRoot || ""),
      command: String(raw.command || "(unknown)"),
      startedAt: String(raw.startedAt || "(unknown)"),
      reason: String(raw.reason || "test gate"),
    };
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function formatConflict(projectRoot: string, path: string, owner: TestGateOwner): string {
  return [
    "test gate blocked: another Bun test gate is already running for this project.",
    "",
    `project: ${projectRoot}`,
    `lock: ${path}`,
    `owner pid: ${owner.pid}`,
    `owner parent pid: ${owner.ppid}`,
    `owner started: ${owner.startedAt}`,
    `owner command: ${owner.command}`,
    "",
    "Refusing to start another bun test because concurrent test gates can orphan long-running suites and slow the whole machine.",
    "Wait for the owner to finish, stop that process group, or set KIMI_ALLOW_CONCURRENT_TESTS=1 when concurrency is intentional.",
  ].join("\n");
}

function removeStaleLock(path: string): void {
  removePath(path, { recursive: true, force: true });
}

/**
 * Housekeeping: remove every `.kimi-test-locks/*-test-gate.lock` under
 * `projectRoot` whose owner pid is dead. Returns the removed lock paths.
 * Locks with live owners are left untouched.
 */
export function clearStaleTestGateLocks(projectRoot: string): string[] {
  const normalized = projectRoot.startsWith("/")
    ? projectRoot.replace(/\/+$/, "")
    : `${process.cwd()}/${projectRoot}`.replace(/\/+$/, "");
  const base = Bun.env.KIMI_TEST_LOCK_DIR ?? `${normalized}/.kimi-test-locks`;
  if (!pathExists(base)) return [];

  const removed: string[] = [];
  for (const entry of listDir(base)) {
    if (!entry.endsWith(`-${LOCK_DIR_NAME}`)) continue;
    const lockPath = `${base}/${entry}`;
    const owner = parseOwner(lockPath);
    if (!owner || !isPidAlive(owner.pid)) {
      removeStaleLock(lockPath);
      removed.push(lockPath);
    }
  }
  return removed;
}

export function acquireTestGateLock(
  projectRoot: string,
  reason = "test gate"
): TestGateAcquireResult {
  const normalizedProjectRoot = projectRoot.startsWith("/")
    ? projectRoot
    : `${process.cwd()}/${projectRoot}`;
  if (Bun.env.KIMI_ALLOW_CONCURRENT_TESTS === "1") {
    return {
      ok: true,
      lock: {
        path: "",
        owner: {
          pid: process.pid,
          ppid: process.ppid,
          projectRoot: normalizedProjectRoot,
          command: currentCommand(),
          startedAt: new Date().toISOString(),
          reason,
        },
        release: () => {},
      },
    };
  }

  const path = resolveTestGateLockPath(normalizedProjectRoot);
  const parent = path.slice(0, path.lastIndexOf("/"));
  makeDir(parent, { recursive: true });

  while (true) {
    try {
      makeDir(path);
      break;
    } catch {
      const owner = parseOwner(path);
      if (!owner || !isPidAlive(owner.pid)) {
        removeStaleLock(path);
        continue;
      }
      return {
        ok: false,
        conflict: {
          path,
          owner,
          message: formatConflict(normalizedProjectRoot, path, owner),
        },
      };
    }
  }

  const owner: TestGateOwner = {
    pid: process.pid,
    ppid: process.ppid,
    projectRoot: normalizedProjectRoot,
    command: currentCommand(),
    startedAt: new Date().toISOString(),
    reason,
  };
  writeText(`${path}/${OWNER_FILE}`, `${JSON.stringify(owner, null, 2)}\n`);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (pathExists(path)) removePath(path, { recursive: true, force: true });
  };

  return { ok: true, lock: { path, owner, release } };
}
