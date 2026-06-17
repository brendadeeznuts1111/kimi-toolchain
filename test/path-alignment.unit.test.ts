import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { basename, join } from "path";
import { REPO_ROOT, testTempDir } from "./helpers.ts";
import {
  auditPathAlignment,
  getExpectedBinNames,
  listMissingWrappers,
  listStaleWrappers,
  removeOrphanedSnapshots,
  removeStaleWrappers,
} from "../src/lib/workspace-health.ts";

describe("path-alignment", () => {
  let tmpHome: string;
  let tmpBin: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = Bun.env.HOME;
    tmpHome = testTempDir("kimi-path-align-");
    tmpBin = join(tmpHome, ".local", "bin");
    makeDir(tmpBin, { recursive: true });
    Bun.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (previousHome === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = previousHome;
    if (tmpHome) removePath(tmpHome, { recursive: true, force: true });
  });

  test("getExpectedBinNames reads package.json bin keys", async () => {
    const bins = await getExpectedBinNames(REPO_ROOT);
    expect(bins).toContain("kimi-doctor");
    expect(bins).toContain("kimi-guardian");
  });

  test("listStaleWrappers finds wrappers not in package.json", async () => {
    writeText(join(tmpBin, "kimi-doctor"), "#!/bin/bash\n");
    writeText(join(tmpBin, "kimi-legacy-tool"), "#!/bin/bash\n");

    const stale = await listStaleWrappers(REPO_ROOT, tmpBin);
    expect(stale).toContain("kimi-legacy-tool");
    expect(stale).not.toContain("kimi-doctor");
  });

  test("listMissingWrappers finds absent wrappers", async () => {
    writeText(join(tmpBin, "kimi-doctor"), "#!/bin/bash\n");
    const missing = await listMissingWrappers(REPO_ROOT, tmpBin);
    expect(missing).not.toContain("kimi-doctor");
    expect(missing.length).toBeGreaterThan(0);
  });

  test("auditPathAlignment passes for canonical repo layout", async () => {
    const report = await auditPathAlignment(REPO_ROOT);
    const repoFolder = report.checks.find((c) => c.name === "repo-folder");
    expect(repoFolder?.status).toBe("ok");
    expect(basename(REPO_ROOT)).toBe("kimi-toolchain");
  });

  test("removeStaleWrappers deletes only stale entries", () => {
    writeText(join(tmpBin, "kimi-stale"), "#!/bin/bash\n");
    writeText(join(tmpBin, "kimi-doctor"), "#!/bin/bash\n");
    const removed = removeStaleWrappers(["kimi-stale"], tmpBin);
    expect(removed).toBe(1);
    expect(Bun.file(join(tmpBin, "kimi-doctor")).size).toBeGreaterThan(0);
  });

  test("removeOrphanedSnapshots deletes broken snapshot paths", async () => {
    const snapDir = join(tmpHome, ".kimi-code", "snapshots");
    makeDir(snapDir, { recursive: true });
    writeText(
      join(snapDir, "snap-bad.json"),
      JSON.stringify({
        id: "snap-bad",
        project: "kimicode-cli",
        projectPath: "/tmp/does-not-exist-kimi-toolchain-test",
        commit: "abc123",
      })
    );

    const removed = await removeOrphanedSnapshots(snapDir);
    expect(removed).toBe(1);
  });
});
