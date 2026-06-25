import { describe, expect, test } from "bun:test";
import { join } from "path";
import { canonicalRepoRoot } from "../src/lib/paths.ts";
import {
  resolveSyncManagedDesktopPath,
  resolveSyncManagedSourcePath,
} from "../src/lib/desktop-sync.ts";

const REPO_ROOT = join(import.meta.dir, "..");

describe("paths canonical-repo-root", () => {
  test("resolves from repo root unchanged", () => {
    expect(canonicalRepoRoot(REPO_ROOT)).toBe(REPO_ROOT);
  });

  test("walks up from src/ to repo root", () => {
    expect(canonicalRepoRoot(join(REPO_ROOT, "src"))).toBe(REPO_ROOT);
  });

  test("walks up from src/lib/ to repo root", () => {
    expect(canonicalRepoRoot(join(REPO_ROOT, "src", "lib"))).toBe(REPO_ROOT);
  });
});

describe("sync path resolution", () => {
  test("resolveSyncManagedSourcePath prevents src/src/bin", () => {
    const binPath = resolveSyncManagedSourcePath(join(REPO_ROOT, "src"), "tools/kimi-doctor.ts");
    expect(binPath).toBe(join(REPO_ROOT, "src", "bin", "kimi-doctor.ts"));
    expect(binPath).not.toContain("src/src");
  });

  test("resolveSyncManagedDesktopPath mirrors tools layout", () => {
    const desktop = resolveSyncManagedDesktopPath("lib/paths.ts");
    expect(desktop).toEndWith("/.kimi-code/lib/paths.ts");
  });
});
