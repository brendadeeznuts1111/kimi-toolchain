import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import {
  auditPathAlignment,
  getExpectedBinNames,
  listMissingWrappers,
  listStaleWrappers,
  removeOrphanedSnapshots,
  removeStaleWrappers,
} from "../src/lib/workspace-health.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("path-alignment", () => {
  let tmpHome: string;
  let tmpBin: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = Bun.env.HOME;
    tmpHome = join(tmpdir(), `kimi-path-align-${Bun.randomUUIDv7()}`);
    tmpBin = join(tmpHome, ".local", "bin");
    mkdirSync(tmpBin, { recursive: true });
    Bun.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = originalHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  test("getExpectedBinNames reads package.json bin keys", async () => {
    const bins = await getExpectedBinNames(REPO_ROOT);
    expect(bins).toContain("kimi-doctor");
    expect(bins).toContain("kimi-guardian");
  });

  test("listStaleWrappers finds wrappers not in package.json", async () => {
    writeFileSync(join(tmpBin, "kimi-doctor"), "#!/bin/bash\n");
    writeFileSync(join(tmpBin, "kimi-legacy-tool"), "#!/bin/bash\n");

    const stale = await listStaleWrappers(REPO_ROOT, tmpBin);
    expect(stale).toContain("kimi-legacy-tool");
    expect(stale).not.toContain("kimi-doctor");
  });

  test("listMissingWrappers finds absent wrappers", async () => {
    writeFileSync(join(tmpBin, "kimi-doctor"), "#!/bin/bash\n");
    const missing = await listMissingWrappers(REPO_ROOT, tmpBin);
    expect(missing).not.toContain("kimi-doctor");
    expect(missing.length).toBeGreaterThan(0);
  });

  test("auditPathAlignment passes for canonical repo layout", async () => {
    Bun.env.HOME = originalHome ?? tmpHome;
    const report = await auditPathAlignment(REPO_ROOT);
    const repoFolder = report.checks.find((c) => c.name === "repo-folder");
    expect(repoFolder?.status).toBe("ok");
    expect(basename(REPO_ROOT)).toBe("kimi-toolchain");
  });

  test("removeStaleWrappers deletes only stale entries", () => {
    writeFileSync(join(tmpBin, "kimi-stale"), "#!/bin/bash\n");
    writeFileSync(join(tmpBin, "kimi-doctor"), "#!/bin/bash\n");
    const removed = removeStaleWrappers(["kimi-stale"], tmpBin);
    expect(removed).toBe(1);
    expect(Bun.file(join(tmpBin, "kimi-doctor")).size).toBeGreaterThan(0);
  });

  test("removeOrphanedSnapshots deletes broken snapshot paths", async () => {
    const snapDir = join(tmpHome, ".kimi-code", "snapshots");
    mkdirSync(snapDir, { recursive: true });
    writeFileSync(
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
