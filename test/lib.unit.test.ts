import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import {
  safeParse,
  sha256String,
  sha256File,
  getProjectName,
  ensureDir,
  findExecutable,
  resolveProjectRoot,
} from "../src/lib/utils.ts";
import { TOOLCHAIN_VERSION, TOOLCHAIN_NAME } from "../src/lib/version.ts";
import { getChromeRssMB, getAppRssGroups, getLoadPerCore } from "../src/lib/memory-budget.ts";
import {
  DEFAULT_CONFIG_TEMPLATE,
  getGovernorConfigPath,
  loadGovernorDefaults,
  BUILTIN_DEFAULTS,
} from "../src/lib/governor-config.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("lib/utils", () => {
  test("safeParse returns parsed JSON on valid input", () => {
    expect(safeParse('{"ok":true}', { ok: false })).toEqual({ ok: true });
  });

  test("safeParse returns fallback on invalid JSON", () => {
    expect(safeParse("not-json", { fallback: 1 })).toEqual({ fallback: 1 });
  });

  test("sha256String produces 64-char hex digest", () => {
    const hash = sha256String("kimi-toolchain");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256String("kimi-toolchain")).toBe(hash);
  });

  test("getProjectName extracts directory basename", () => {
    expect(getProjectName("/tmp/kimi-toolchain")).toBe("kimi-toolchain");
    expect(getProjectName("/")).toBe("unknown");
  });

  test("ensureDir creates missing directories", () => {
    const dir = join(REPO_ROOT, ".tmp-test-ensure-dir");
    ensureDir(dir);
    expect(existsSync(dir)).toBe(true);
    Bun.spawnSync(["rm", "-rf", dir]);
  });

  test("findExecutable resolves bun on PATH", () => {
    expect(findExecutable("bun")).toBeTruthy();
  });

  test("sha256File hashes on-disk content", async () => {
    const path = join(REPO_ROOT, "package.json");
    const hash = await sha256File(path);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(sha256String(await Bun.file(path).text()));
  });

  test("resolveProjectRoot returns git toplevel in repo", async () => {
    const root = await resolveProjectRoot(REPO_ROOT);
    expect(root).toContain("kimi-toolchain");
    expect(existsSync(join(root, "package.json"))).toBe(true);
  });
});

describe("lib/version", () => {
  test("TOOLCHAIN_VERSION is semver-like", () => {
    expect(TOOLCHAIN_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("TOOLCHAIN_NAME is kimi-toolchain", () => {
    expect(TOOLCHAIN_NAME).toBe("kimi-toolchain");
  });
});

describe("lib/memory-budget", () => {
  test("getChromeRssMB returns non-negative number", () => {
    expect(getChromeRssMB()).toBeGreaterThanOrEqual(0);
  });

  test("getAppRssGroups returns labeled groups", () => {
    const groups = getAppRssGroups();
    expect(Array.isArray(groups)).toBe(true);
    for (const g of groups) {
      expect(g.label.length).toBeGreaterThan(0);
      expect(g.mb).toBeGreaterThanOrEqual(0);
    }
  });

  test("getLoadPerCore returns load metrics", async () => {
    const { load, cores, perCore } = await getLoadPerCore();
    expect(cores).toBeGreaterThan(0);
    expect(load).toBeGreaterThanOrEqual(0);
    expect(perCore).toBeGreaterThanOrEqual(0);
  });
});

describe("lib/governor-config", () => {
  test("DEFAULT_CONFIG_TEMPLATE includes governor keys", () => {
    expect(DEFAULT_CONFIG_TEMPLATE).toContain("maxMemoryMB");
    expect(DEFAULT_CONFIG_TEMPLATE).toContain("maxParallelJobs");
  });

  test("getGovernorConfigPath points under kimi-code", () => {
    expect(getGovernorConfigPath()).toContain(".kimi-code/governor");
  });

  test("loadGovernorDefaults returns numeric limits", async () => {
    const defaults = await loadGovernorDefaults();
    expect(defaults.maxMemoryMB).toBeGreaterThan(0);
    expect(defaults.maxParallelJobs).toBeGreaterThan(0);
    expect(defaults.wallClockMs).toBe(BUILTIN_DEFAULTS.wallClockMs);
  });
});
