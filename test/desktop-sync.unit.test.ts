import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { artifactPath } from "../src/lib/artifacts.ts";
import { ensureDesktopLayout, syncDesktop } from "../src/lib/desktop-sync.ts";
import { desktopRoot, libDir, scriptsDir, toolsDir } from "../src/lib/paths.ts";
import { LABEL_PREFIX, SYNC_ROUTES, repoSourceDir } from "../src/lib/desktop-sync.ts";

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

  test("SYNC_ROUTES maps repo sources to desktop targets", () => {
    const tools = SYNC_ROUTES.find((r) => r.prefix === LABEL_PREFIX.TOOLS)!;
    expect(repoSourceDir(REPO_ROOT, tools.repoSegments)).toContain("src/bin");
    expect(tools.desktopDir()).toContain(".kimi-code/tools");
  });

  test("ensureDesktopLayout creates desktop dirs", () => {
    ensureDesktopLayout();
    expect(existsSync(toolsDir())).toBe(true);
    expect(existsSync(libDir())).toBe(true);
    expect(existsSync(scriptsDir())).toBe(true);
  });

  test("syncDesktop is idempotent and removes orphan tools", async () => {
    await syncDesktop(REPO_ROOT, { force: true });
    const second = await syncDesktop(REPO_ROOT);
    expect(second.updated.length).toBe(0);
    expect(existsSync(join(desktopRoot(), "tools", "kimi-doctor.ts"))).toBe(true);

    const orphanPath = join(desktopRoot(), "tools", "kimi-utils.ts");
    await Bun.write(orphanPath, "// legacy orphan\n");
    const cleaned = await syncDesktop(REPO_ROOT, { force: true });
    expect(cleaned.removed).toContain("tools/kimi-utils.ts");
    expect(existsSync(orphanPath)).toBe(false);
  });
});