import { pathExists } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { cleanupPath, testTempDir, withEnv } from "./helpers.ts";
import {
  desktopRuntimeDepsOk,
  probeDesktopRuntimeEntrypoints,
  provisionDesktopRuntimeDeps,
  purgeCorruptLinksEntries,
  RuntimeDepCorruptError,
  TAXONOMY_ID_RUNTIME_DEP_CORRUPT,
} from "../src/lib/desktop-runtime-deps.ts";

describe("desktop-runtime-deps", () => {
  test("provisionDesktopRuntimeDeps installs typescript into desktop root", async () => {
    const fakeHome = testTempDir("desktop-runtime-");
    try {
      await withEnv({ HOME: fakeHome }, async () => {
        const result = await provisionDesktopRuntimeDeps();
        expect(result.installed).toBe(true);
        expect(desktopRuntimeDepsOk(fakeHome)).toBe(true);
        expect(
          pathExists(join(fakeHome, ".kimi-code", "node_modules", "typescript", "package.json"))
        ).toBe(true);
        expect(
          pathExists(join(fakeHome, ".kimi-code", "node_modules", "ts-morph", "package.json"))
        ).toBe(true);
      });
    } finally {
      cleanupPath(fakeHome);
    }
  });

  test("desktopRuntimeDepsOk reports false when any template dep is missing", async () => {
    const fakeHome = testTempDir("desktop-runtime-");
    try {
      // Hermetic node_modules: real dirs only, never seeded symlinks into the
      // shared links cache — deleting through those corrupts every project on
      // the machine. Dep list comes from the same template SSOT as the check.
      const template = (await Bun.file(
        join(import.meta.dir, "..", "templates", "desktop-runtime", "package.json")
      ).json()) as { dependencies: Record<string, string> };
      const nodeModules = join(fakeHome, ".kimi-code", "node_modules");
      for (const dep of Object.keys(template.dependencies)) {
        await Bun.write(join(nodeModules, dep, "package.json"), JSON.stringify({ name: dep }));
      }
      expect(desktopRuntimeDepsOk(fakeHome)).toBe(true);
      cleanupPath(join(nodeModules, "ts-morph", "package.json"));
      expect(desktopRuntimeDepsOk(fakeHome)).toBe(false);
    } finally {
      cleanupPath(fakeHome);
    }
  });

  test("purgeCorruptLinksEntries removes only entries missing package.json", async () => {
    const cacheDir = testTempDir("links-cache-");
    try {
      const linksDir = join(cacheDir, "links");
      const corrupt = join(linksDir, "foo@1.0.0-aaaa", "node_modules", "foo");
      const healthy = join(linksDir, "foo@1.0.0-bbbb", "node_modules", "foo");
      const scoped = join(linksDir, "@scope+bar@2.0.0-cccc", "node_modules", "@scope", "bar");
      await Bun.write(join(corrupt, "index.js"), "export {};\n");
      await Bun.write(join(healthy, "package.json"), '{"name":"foo"}\n');
      await Bun.write(join(scoped, "index.js"), "export {};\n");
      await withEnv({ BUN_INSTALL_CACHE_DIR: cacheDir }, async () => {
        const purged = purgeCorruptLinksEntries(["foo", "@scope/bar"]);
        expect(purged.some((dir) => dir.includes("foo@1.0.0-aaaa"))).toBe(true);
        expect(purged.some((dir) => dir.includes("@scope+bar@2.0.0-cccc"))).toBe(true);
        expect(purged.some((dir) => dir.includes("foo@1.0.0-bbbb"))).toBe(false);
        expect(pathExists(join(linksDir, "foo@1.0.0-aaaa"))).toBe(false);
        expect(pathExists(join(linksDir, "@scope+bar@2.0.0-cccc"))).toBe(false);
        expect(pathExists(join(healthy, "package.json"))).toBe(true);
      });
    } finally {
      cleanupPath(cacheDir);
    }
  });

  test("probeDesktopRuntimeEntrypoints reports failure when an entrypoint fails to load", async () => {
    const seenArgs: string[][] = [];
    const probe = await probeDesktopRuntimeEntrypoints("/fake/desktop", async (args) => {
      seenArgs.push(args);
      return { exitCode: 1, stderr: "Cannot find package 'ts-morph'\n" };
    });
    expect(probe.ok).toBe(false);
    expect(probe.failures).toHaveLength(1);
    expect(probe.failures[0]?.entrypoint).toBe("tools/kimi-doctor.ts");
    expect(probe.failures[0]?.error).toContain("Cannot find package 'ts-morph'");
    expect(seenArgs).toHaveLength(1);
    expect(seenArgs[0]?.[1]).toContain(join("/fake/desktop", "tools", "kimi-doctor.ts"));
  });

  test("probeDesktopRuntimeEntrypoints passes when every entrypoint loads", async () => {
    const probe = await probeDesktopRuntimeEntrypoints("/fake/desktop", async () => ({
      exitCode: 0,
      stderr: "",
    }));
    expect(probe.ok).toBe(true);
    expect(probe.failures).toHaveLength(0);
  });

  test("RuntimeDepCorruptError carries taxonomy id and missing deps", () => {
    const err = new RuntimeDepCorruptError(["ts-morph"], "/tmp/desktop");
    expect(err.taxonomyId).toBe(TAXONOMY_ID_RUNTIME_DEP_CORRUPT);
    expect(err.missingDeps).toEqual(["ts-morph"]);
    expect(err.message).toContain("runtime_dep_corrupt");
    expect(err.message).toContain("ts-morph");
  });
});
