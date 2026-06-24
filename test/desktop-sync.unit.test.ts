import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { artifactPath } from "../src/lib/artifacts.ts";
import {
  CANONICAL_REFERENCES_FILENAME,
  collectRootLocalDocSyncPaths,
} from "../src/lib/canonical-references.ts";
import {
  collectStaticFileSyncPaths,
  desktopRoot,
  ensureDesktopLayout,
  resolveDesktopPaths,
  SYNC_ROOT_INFRA,
  syncDesktop,
} from "../src/lib/desktop-sync.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("desktop-sync", () => {
  let prevHome: string | undefined;
  let testHome: string | undefined;

  beforeEach(() => {
    prevHome = Bun.env.HOME;
    testHome = artifactPath(REPO_ROOT, "tmp", `desktop-home-${Date.now()}-${Bun.randomUUIDv7()}`);
    mkdirSync(testHome, { recursive: true });
    Bun.env.HOME = testHome;
  });

  afterEach(() => {
    if (prevHome) Bun.env.HOME = prevHome;
    else delete Bun.env.HOME;
    if (testHome) rmSync(testHome, { recursive: true, force: true });
    testHome = undefined;
  });

  test("resolveDesktopPaths maps repo to desktop targets", () => {
    const paths = resolveDesktopPaths(REPO_ROOT);
    expect(paths.binSrc).toContain("src/bin");
    expect(paths.binDst).toContain(".kimi-code/tools");
    expect(paths.scriptsSrc).toContain("scripts");
    expect(paths.templatesDst).toContain(".kimi-code/templates");
  });

  test("collectStaticFileSyncPaths merges manifest localDocs and infra", () => {
    const paths = collectStaticFileSyncPaths();
    for (const doc of collectRootLocalDocSyncPaths()) {
      expect(paths).toContain(doc);
    }
    for (const doc of SYNC_ROOT_INFRA) {
      expect(paths).toContain(doc);
    }
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain("DEEP-QUALITY.md");
    expect(paths).toContain(CANONICAL_REFERENCES_FILENAME);
  });

  test("syncDesktop copies nested manifest localDocs under desktop tree", async () => {
    const tmpHome = artifactPath(REPO_ROOT, "tmp", `desktop-nested-docs-${Date.now()}`);
    mkdirSync(tmpHome, { recursive: true });
    Bun.env.HOME = tmpHome;
    try {
      const result = await syncDesktop(REPO_ROOT, { force: true });
      const nested = "docs/references/testing-execution.md";
      expect(result.updated).toContain(nested);
      expect(existsSync(join(desktopRoot(), nested))).toBe(true);
      expect(existsSync(join(desktopRoot(), "docs/handoff-rules.md"))).toBe(true);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("syncDesktop copies manifest root localDocs to desktop root", async () => {
    const tmpHome = artifactPath(REPO_ROOT, "tmp", `desktop-root-docs-${Date.now()}`);
    mkdirSync(tmpHome, { recursive: true });
    Bun.env.HOME = tmpHome;
    try {
      const result = await syncDesktop(REPO_ROOT, { force: true });
      expect(result.updated).toContain("DEEP-QUALITY.md");
      expect(result.updated).toContain(CANONICAL_REFERENCES_FILENAME);
      expect(existsSync(join(desktopRoot(), "DEEP-QUALITY.md"))).toBe(true);
      expect(existsSync(join(desktopRoot(), CANONICAL_REFERENCES_FILENAME))).toBe(true);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("ensureDesktopLayout creates desktop dirs", () => {
    ensureDesktopLayout();
    const paths = resolveDesktopPaths(REPO_ROOT);
    expect(existsSync(paths.binDst)).toBe(true);
    expect(existsSync(paths.libDst)).toBe(true);
    expect(existsSync(paths.scriptsDst)).toBe(true);
  });

  test("syncDesktop is idempotent on second run", async () => {
    await syncDesktop(REPO_ROOT, { force: true });
    const second = await syncDesktop(REPO_ROOT);
    expect(second.updated.length).toBe(0);
    expect(existsSync(join(pathsToolchain(REPO_ROOT), "tools", "kimi-doctor.ts"))).toBe(true);
  });

  test("syncDesktop force overwrites stale optional config", async () => {
    const tmpHome = artifactPath(REPO_ROOT, "tmp", `desktop-force-${Date.now()}`);
    mkdirSync(tmpHome, { recursive: true });
    Bun.env.HOME = tmpHome;
    try {
      await syncDesktop(REPO_ROOT);
      await Bun.write(join(desktopRoot(), "bunfig.toml"), "# stale copy\n");
      const result = await syncDesktop(REPO_ROOT, { force: true });
      expect(result.updated).toContain("bunfig.toml");
      const text = await Bun.file(join(desktopRoot(), "bunfig.toml")).text();
      expect(text).not.toBe("# stale copy\n");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("syncDesktop removes orphaned tool files", async () => {
    const tmpHome = artifactPath(REPO_ROOT, "tmp", `desktop-orphan-${Date.now()}`);
    mkdirSync(tmpHome, { recursive: true });
    Bun.env.HOME = tmpHome;
    try {
      await syncDesktop(REPO_ROOT, { force: true });
      const orphanPath = join(desktopRoot(), "tools", "kimi-utils.ts");
      await Bun.write(orphanPath, "// legacy orphan\n");
      const result = await syncDesktop(REPO_ROOT, { force: true });
      expect(result.removed).toContain("tools/kimi-utils.ts");
      expect(existsSync(orphanPath)).toBe(false);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test(
    "syncDesktop copies optional config when desktop copy missing",
    async () => {
      const tmpHome = artifactPath(REPO_ROOT, "tmp", `desktop-${Date.now()}`);
      mkdirSync(tmpHome, { recursive: true });
      Bun.env.HOME = tmpHome;
      try {
        const result = await syncDesktop(REPO_ROOT);
        expect(result.updated.some((u) => u === "bunfig.toml" || u.includes("bunfig"))).toBe(true);
        expect(existsSync(join(desktopRoot(), "bunfig.toml"))).toBe(true);
      } finally {
        rmSync(tmpHome, { recursive: true, force: true });
      }
    },
    { timeout: 15_000 }
  );

  test(
    "syncDesktop copies lib JSON sidecars imported by synced modules",
    async () => {
      const tmpHome = artifactPath(REPO_ROOT, "tmp", `desktop-lib-json-${Date.now()}`);
      mkdirSync(tmpHome, { recursive: true });
      Bun.env.HOME = tmpHome;
      try {
        const result = await syncDesktop(REPO_ROOT, { force: true });
        expect(result.updated).toContain("lib/bun-upstream-cli-manifest.json");
        expect(result.updated).toContain("lib/bun-upstream-cli-cases.json");
        expect(existsSync(join(desktopRoot(), "lib", "bun-upstream-cli-manifest.json"))).toBe(true);
        expect(existsSync(join(desktopRoot(), "lib", "bun-upstream-cli-cases.json"))).toBe(true);
      } finally {
        rmSync(tmpHome, { recursive: true, force: true });
      }
    },
    { timeout: 15_000 }
  );

  test("syncDesktop copies scaffold templates", async () => {
    const tmpHome = artifactPath(REPO_ROOT, "tmp", `desktop-templates-${Date.now()}`);
    mkdirSync(tmpHome, { recursive: true });
    Bun.env.HOME = tmpHome;
    try {
      const result = await syncDesktop(REPO_ROOT, { force: true });
      expect(result.updated).toContain("templates/scaffold/oxfmtrc.json");
      expect(existsSync(join(desktopRoot(), "templates", "scaffold", "oxfmtrc.json"))).toBe(true);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

function pathsToolchain(repoRoot: string) {
  return resolveDesktopPaths(repoRoot).desktopRoot;
}
