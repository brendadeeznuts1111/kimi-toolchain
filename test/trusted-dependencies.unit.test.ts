import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import {
  addTrustedDependencies,
  readTrustedDependencies,
  scanUntrustedInstallScripts,
  stripLegacyBunfigTrustedDependencies,
} from "../src/lib/trusted-dependencies.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("trusted-dependencies", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) removePath(tmpDir, { recursive: true, force: true });
  });

  function setupProject(files: Record<string, string>): string {
    tmpDir = join(REPO_ROOT, `.tmp-trusted-deps-${Date.now()}`);
    makeDir(tmpDir, { recursive: true });
    for (const [rel, body] of Object.entries(files)) {
      const path = join(tmpDir, rel);
      makeDir(join(path, ".."), { recursive: true });
      writeText(path, body);
    }
    return tmpDir;
  }

  test("reads trustedDependencies from package.json", async () => {
    const project = setupProject({
      "package.json": JSON.stringify({ trustedDependencies: ["esbuild"] }, null, 2),
    });
    const { trusted } = await readTrustedDependencies(project);
    expect([...trusted]).toEqual(["esbuild"]);
  });

  test("falls back to legacy bunfig trustedDependencies", async () => {
    const project = setupProject({
      "package.json": JSON.stringify({ name: "demo" }, null, 2),
      "bunfig.toml": `[install]\ntrustedDependencies = ["sharp"]\n`,
    });
    const { trusted, legacyBunfigTrusted } = await readTrustedDependencies(project);
    expect(legacyBunfigTrusted).toEqual(["sharp"]);
    expect([...trusted]).toEqual(["sharp"]);
  });

  test("prefers package.json over bunfig when both are set", async () => {
    const project = setupProject({
      "package.json": JSON.stringify({ trustedDependencies: ["esbuild"] }, null, 2),
      "bunfig.toml": `[install]\ntrustedDependencies = ["sharp"]\n`,
    });
    const { trusted } = await readTrustedDependencies(project);
    expect([...trusted]).toEqual(["esbuild"]);
  });

  test("addTrustedDependencies writes package.json and strips bunfig legacy", async () => {
    const project = setupProject({
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0" }, null, 2),
      "bunfig.toml": `[install]\ntrustedDependencies = ["sharp"]\n`,
    });

    const result = await addTrustedDependencies(project, ["esbuild"]);
    expect(result.added).toEqual(["esbuild"]);

    const pkg = (await Bun.file(join(project, "package.json")).json()) as {
      trustedDependencies?: string[];
    };
    expect(pkg.trustedDependencies).toEqual(["sharp", "esbuild"]);

    const bunfig = await Bun.file(join(project, "bunfig.toml")).text();
    expect(bunfig.includes("trustedDependencies")).toBe(false);
    expect(result.migratedFromBunfig).toBe(true);
  });

  test("scanUntrustedInstallScripts flags deps with lifecycle scripts", async () => {
    const project = setupProject({
      "package.json": JSON.stringify(
        {
          dependencies: { trustedPkg: "1.0.0", riskyPkg: "1.0.0" },
          trustedDependencies: ["trustedPkg"],
        },
        null,
        2
      ),
      "node_modules/trustedPkg/package.json": JSON.stringify({
        name: "trustedPkg",
        scripts: { postinstall: "node setup.js" },
      }),
      "node_modules/riskyPkg/package.json": JSON.stringify({
        name: "riskyPkg",
        scripts: { postinstall: "node evil.js" },
      }),
    });

    const scan = await scanUntrustedInstallScripts(project);
    expect(scan.untrusted).toEqual(["riskyPkg"]);
    expect(scan.trusted).toEqual(["trustedPkg"]);
  });

  test("stripLegacyBunfigTrustedDependencies is idempotent", async () => {
    const project = setupProject({
      "bunfig.toml": `[install]\nsaveTextLockfile = true\n`,
    });
    expect(await stripLegacyBunfigTrustedDependencies(project)).toBe(false);
  });
});
