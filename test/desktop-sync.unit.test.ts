import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { artifactPath } from "../src/lib/artifacts.ts";
import { ensureDesktopLayout, syncDesktop } from "../src/lib/desktop-sync.ts";
import { desktopRoot, libDir, scriptsDir, toolsDir } from "../src/lib/paths.ts";
import { LABEL_PREFIX, SYNC_ROUTES, repoSourceDir } from "../src/lib/desktop-sync.ts";
import { makeDir, pathExists, removePath } from "./helpers.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("desktop-sync", () => {
  let prevHome: string | undefined;
  let testHome: string | undefined;

  beforeEach(() => {
    prevHome = Bun.env.HOME;
    testHome = artifactPath(REPO_ROOT, "tmp", `desktop-home-${Date.now()}-${Bun.randomUUIDv7()}`);
    makeDir(testHome, { recursive: true });
    Bun.env.HOME = testHome;
  });

  afterEach(() => {
    if (prevHome) Bun.env.HOME = prevHome;
    else delete Bun.env.HOME;
    if (testHome) removePath(testHome, { recursive: true, force: true });
    testHome = undefined;
  });

  test("SYNC_ROUTES maps repo sources to desktop targets", () => {
    const tools = SYNC_ROUTES.find((r) => r.prefix === LABEL_PREFIX.TOOLS)!;
    expect(repoSourceDir(REPO_ROOT, tools.repoSegments)).toContain("src/bin");
    expect(tools.desktopDir()).toContain(".kimi-code/tools");
  });

  test("ensureDesktopLayout creates desktop dirs", () => {
    ensureDesktopLayout();
    expect(pathExists(toolsDir())).toBe(true);
    expect(pathExists(libDir())).toBe(true);
    expect(pathExists(scriptsDir())).toBe(true);
  });

  test("syncDesktop is idempotent and removes orphan tools", async () => {
    await syncDesktop(REPO_ROOT, { force: true });
    const second = await syncDesktop(REPO_ROOT);
    expect(second.updated.length).toBe(0);
    expect(pathExists(join(desktopRoot(), "tools", "kimi-doctor.ts"))).toBe(true);

    const orphanPath = join(desktopRoot(), "tools", "kimi-utils.ts");
    await Bun.write(orphanPath, "// legacy orphan\n");
    const cleaned = await syncDesktop(REPO_ROOT, { force: true });
    expect(cleaned.removed).toContain("tools/kimi-utils.ts");
    expect(pathExists(orphanPath)).toBe(false);
  });
});
