import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  safeParse,
  safeToml,
  sha256String,
  sha256File,
  getProjectName,
  ensureDir,
  findExecutable,
  resolveProjectRoot,
  log,
  printSection,
  printToolBanner,
  buildDoctorReport,
  printDoctorReport,
  streamToText,
  runTool,
  fetchWithTimeout,
} from "../src/lib/utils.ts";
import { TOOLCHAIN_VERSION, TOOLCHAIN_NAME } from "../src/lib/version.ts";
import { artifactPath } from "../src/lib/artifacts.ts";
import {
  getChromeRssMB,
  getAppRssGroups,
  getLoadPerCore,
  countBlockingErrors,
} from "../src/lib/memory-budget.ts";
import {
  DEFAULT_CONFIG_TEMPLATE,
  getGovernorConfigPath,
  loadGovernorDefaults,
  BUILTIN_DEFAULTS,
} from "../src/lib/governor-config.ts";
import { captureStdout } from "./helpers.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("lib/utils", () => {
  test("safeParse returns parsed JSON on valid input", () => {
    expect(safeParse('{"ok":true}', { ok: false })).toEqual({ ok: true });
  });

  test("safeParse returns fallback on invalid JSON", () => {
    expect(safeParse("not-json", { fallback: 1 })).toEqual({ fallback: 1 });
  });

  test("safeParse with validator accepts valid shape", () => {
    const isStringRecord = (v: unknown): v is Record<string, string> =>
      typeof v === "object" && v !== null && Object.values(v).every((x) => typeof x === "string");
    expect(safeParse('{"a":"1"}', {}, isStringRecord)).toEqual({ a: "1" });
  });

  test("safeParse with validator rejects invalid shape", () => {
    const isStringRecord = (v: unknown): v is Record<string, string> =>
      typeof v === "object" && v !== null && Object.values(v).every((x) => typeof x === "string");
    expect(safeParse('{"a":1}', { fallback: "x" }, isStringRecord)).toEqual({ fallback: "x" });
  });

  test("safeToml returns parsed TOML on valid input", () => {
    const parsed = safeToml('[section]\nkey = "value"', { section: {} });
    expect(parsed).toEqual({ section: { key: "value" } });
  });

  test("safeToml returns fallback on invalid TOML", () => {
    expect(safeToml("not-toml", { fallback: true })).toEqual({ fallback: true });
  });

  test("safeToml with validator accepts valid shape", () => {
    const isConfig = (v: unknown): v is { maxMemoryMB: number } =>
      typeof v === "object" &&
      v !== null &&
      "maxMemoryMB" in v &&
      typeof (v as Record<string, unknown>).maxMemoryMB === "number";
    expect(safeToml("maxMemoryMB = 1024", { maxMemoryMB: 0 }, isConfig)).toEqual({
      maxMemoryMB: 1024,
    });
  });

  test("safeToml with validator rejects invalid shape", () => {
    const isConfig = (v: unknown): v is { maxMemoryMB: number } =>
      typeof v === "object" &&
      v !== null &&
      "maxMemoryMB" in v &&
      typeof (v as Record<string, unknown>).maxMemoryMB === "number";
    expect(safeToml('[other]\nkey = "value"', { maxMemoryMB: 0 }, isConfig)).toEqual({
      maxMemoryMB: 0,
    });
  });

  test("sha256String produces 64-char hex digest", () => {
    const hash = sha256String("kimi-toolchain");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256String("kimi-toolchain")).toBe(hash);
  });

  test("getProjectName prefers package.json name over directory", async () => {
    const dir = artifactPath(REPO_ROOT, "tmp", "test-project-name");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-real-app" }));
    expect(await getProjectName(dir)).toBe("my-real-app");
    Bun.spawnSync(["rm", "-rf", dir]);
  });

  test("getProjectName falls back to directory basename", async () => {
    expect(await getProjectName("/tmp/kimi-toolchain")).toBe("kimi-toolchain");
    expect(await getProjectName("/")).toBe("unknown");
  });

  test("ensureDir creates missing directories", () => {
    const dir = artifactPath(REPO_ROOT, "tmp", "test-ensure-dir");
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

  test("log and print helpers emit formatted output", () => {
    const capture = captureStdout();
    try {
      log("info", "ok");
      log("warn", "caution");
      printSection("Section");
      printToolBanner("Banner");
      const report = buildDoctorReport("tool", [
        { name: "a", status: "ok", message: "fine", fixable: false },
        { name: "b", status: "warn", message: "fix me", fixable: true },
      ]);
      printDoctorReport(report);
      expect(capture.lines.some((l) => l.includes("✓ ok"))).toBe(true);
      expect(capture.lines.some((l) => l.includes("Section"))).toBe(true);
      expect(capture.lines.some((l) => l.includes("Banner"))).toBe(true);
      expect(report.warnCount).toBe(1);
      expect(report.fixableCount).toBe(1);
    } finally {
      capture.restore();
    }
  });

  test("fetchWithTimeout returns response from local server", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("pong");
      },
    });
    try {
      const res = await fetchWithTimeout(`http://127.0.0.1:${server.port}`, { timeoutMs: 5000 });
      expect(res).toBeDefined();
    } finally {
      server.stop();
    }
  });

  test("fetchWithTimeout aborts when server is slow", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch() {
        await Bun.sleep(200);
        return new Response("late");
      },
    });
    try {
      await expect(
        fetchWithTimeout(`http://127.0.0.1:${server.port}`, { timeoutMs: 1 })
      ).rejects.toThrow();
    } finally {
      server.stop();
    }
  });

  test("streamToText reads stream content", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.close();
      },
    });
    expect(await streamToText(stream)).toBe("hello");
  });

  describe("runTool", () => {
    let prevHome: string | undefined;

    beforeEach(() => {
      prevHome = Bun.env.HOME;
      Bun.env.HOME = Bun.env.KIMI_TEST_HOME || artifactPath(REPO_ROOT, "test-home");
      mkdirSync(Bun.env.HOME, { recursive: true });
    });

    afterEach(() => {
      if (prevHome) Bun.env.HOME = prevHome;
    });

    test("throws when tool file is missing", async () => {
      await expect(runTool("missing-tool", [])).rejects.toThrow("Tool not found");
    });

    test("runs tool from ~/.kimi-code/tools", async () => {
      const toolsDir = join(Bun.env.HOME!, ".kimi-code", "tools");
      mkdirSync(toolsDir, { recursive: true });
      writeFileSync(
        join(toolsDir, "stub-tool.ts"),
        "#!/usr/bin/env bun\nconsole.log('stub-ok');\n"
      );
      const { stdout, exitCode } = await runTool("stub-tool", [], { timeoutMs: 5000 });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("stub-ok");
    });
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
  test(
    "getChromeRssMB returns non-negative number",
    () => {
      const mb = getChromeRssMB();
      expect(mb).toBeGreaterThanOrEqual(0);
    },
    { timeout: 5000 }
  );

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

  test("countBlockingErrors exempts system checks with --soft-system", () => {
    const results = [
      { name: "memory-free", status: "error" },
      { name: "unified-shell", status: "error" },
      { name: "disk", status: "warn" },
    ];
    expect(countBlockingErrors(results, false)).toEqual({ blocking: 2, system: 0, total: 2 });
    expect(countBlockingErrors(results, true)).toEqual({ blocking: 1, system: 1, total: 2 });
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
