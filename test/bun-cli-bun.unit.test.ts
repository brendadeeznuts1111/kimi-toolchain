/**
 * Ported from oven-sh/bun test/cli/bun.test.ts @ pinned commit.
 */

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { runBunCliContractProbes } from "../src/lib/bun-cli-contract-probes.ts";
import { spawnCaptured, testTempDir, writeText } from "./helpers.ts";
import { removePath } from "../src/lib/bun-io.ts";

// oxlint-disable-next-line eslint/no-control-regex -- ANSI SGR sequences in NO_COLOR probes
const ANSI_RE = /\u001b\[\d+m/;

describe("bun-cli-bun contract probes", () => {
  test("runBunCliContractProbes all pass on current Bun", async () => {
    const failed = (await runBunCliContractProbes()).filter((r) => !r.ok);
    expect(failed).toEqual([]);
  });
});

describe("bun-cli-bun", () => {
  for (const value of ["1", "0", "foo", " "]) {
    test(`NO_COLOR=${JSON.stringify(value)} disables ANSI`, () => {
      const proc = Bun.spawnSync({
        cmd: [process.execPath],
        env: { ...Bun.env, NO_COLOR: value },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(proc.exitCode).toBe(0);
      expect(proc.stdout.toString()).not.toMatch(ANSI_RE);
    });
  }

  test("revision generates version numbers correctly", () => {
    const version = Bun.spawnSync({
      cmd: [process.execPath, "--version"],
      stdout: "pipe",
      stderr: "pipe",
    })
      .stdout.toString()
      .trim();
    const revisionProc = Bun.spawnSync({
      cmd: [process.execPath, "--revision"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const revision = revisionProc.stdout.toString().trim();
    expect(revisionProc.exitCode).toBe(0);
    expect(revision.startsWith(version)).toBe(true);
  });

  test("getcompletes should not panic and should not be empty", () => {
    const proc = Bun.spawnSync({
      cmd: [process.execPath, "getcompletes"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).not.toBe("");
  });

  test("test --config, issue #4128", async () => {
    const path = join(testTempDir("bunfig-config-"), "bunfig.toml");
    writeText(path, "[debug]\n");
    try {
      const cap = await spawnCaptured([process.execPath, `--config=${path}`]);
      expect(cap.exitCode).toBe(0);
    } finally {
      removePath(path, { force: true });
    }
  });
});
