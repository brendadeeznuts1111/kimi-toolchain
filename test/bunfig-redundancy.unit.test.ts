import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import {
  auditWorkspaceBunfigRedundancy,
  readEffectiveUserBunfigInstall,
  readUserBunfigInstall,
  readUserBunfigLayers,
} from "../src/lib/bunfig-redundancy.ts";
import { testTempDir } from "./helpers.ts";

async function withUniqueHome(fn: (home: string) => void | Promise<void>): Promise<void> {
  const home = testTempDir("bunfig-redundancy-home-");
  const previous = Bun.env.HOME;
  Bun.env.HOME = home;
  try {
    await fn(home);
  } finally {
    if (previous === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = previous;
  }
}

const MACHINE_BUNFIG = `[install]
linker = "isolated"
globalStore = true

[install.cache]
dir = "/tmp/machine-bun-cache"
`;

describe("bunfig-redundancy", () => {
  test("flags workspace keys that duplicate ~/.bunfig.toml", async () => {
    const project = testTempDir("bunfig-redundancy-project-");

    writeText(
      join(project, "bunfig.toml"),
      `[install]
linker = "isolated"
globalStore = true
frozenLockfile = true
`
    );
    makeDir(join(project, "packages", "child"), { recursive: true });
    writeText(
      join(project, "packages", "child", "bunfig.toml"),
      `[install]
linker = "hoisted"
`
    );

    await withUniqueHome(async (home) => {
      writeText(join(home, ".bunfig.toml"), MACHINE_BUNFIG);
      const audit = await auditWorkspaceBunfigRedundancy(project);
      expect(audit.ok).toBe(false);
      expect(audit.hits).toHaveLength(1);
      expect(audit.hits[0]?.relativePath).toBe("bunfig.toml");
      expect(audit.hits[0]?.keys).toEqual(["[install].linker", "[install].globalStore"]);
    });
  });

  test("flags tilde cache.dir in workspace bunfig", async () => {
    const project = testTempDir("bunfig-redundancy-tilde-project-");
    writeText(
      join(project, "bunfig.toml"),
      `[install]

[install.cache]
dir = "~/.bun/install/cache"
`
    );

    await withUniqueHome(async (home) => {
      writeText(join(home, ".bunfig.toml"), MACHINE_BUNFIG);
      const audit = await auditWorkspaceBunfigRedundancy(project);
      expect(audit.hits[0]?.keys).toContain("[install.cache].dir");
    });
  });

  test("passes when machine bunfig is missing", async () => {
    const project = testTempDir("bunfig-redundancy-no-machine-project-");
    writeText(
      join(project, "bunfig.toml"),
      `[install]
linker = "isolated"
globalStore = true
`
    );

    await withUniqueHome(async () => {
      const audit = await auditWorkspaceBunfigRedundancy(project);
      expect(audit.ok).toBe(true);
      expect(audit.hits).toHaveLength(0);
    });
  });

  test("readUserBunfigInstall distinguishes dangling from missing", async () => {
    await withUniqueHome(async (home) => {
      const { symlinkSync } = await import("node:fs");
      symlinkSync(join(home, "missing-target.toml"), join(home, ".bunfig.toml"));
      const dangling = await readUserBunfigInstall({ HOME: home });
      expect(dangling.inode).toBe("dangling-symlink");
      expect(dangling.bunfigPath).toBe(join(home, ".bunfig.toml"));
      expect(dangling.install).toBeNull();
    });
    await withUniqueHome(async (home) => {
      const gone = await readUserBunfigInstall({ HOME: home });
      expect(gone.inode).toBe("missing");
      expect(gone.bunfigPath).toBeNull();
    });
  });

  test("readUserBunfigLayers reuses the home snapshot when XDG is absent", async () => {
    await withUniqueHome(async (home) => {
      writeText(join(home, ".bunfig.toml"), MACHINE_BUNFIG);
      const layers = await readUserBunfigLayers({ HOME: home });
      expect(layers.xdgLoaded).toBe(false);
      expect(layers.effective).toBe(layers.machine);
      expect(layers.machine.install?.linker).toBe("isolated");
    });
  });

  test("readEffectiveUserBunfigInstall uses XDG when that file exists", async () => {
    await withUniqueHome(async (home) => {
      writeText(join(home, ".bunfig.toml"), MACHINE_BUNFIG);
      const xdg = join(home, "xdg");
      makeDir(xdg, { recursive: true });
      writeText(join(xdg, ".bunfig.toml"), `[install]\nlinker = "hoisted"\n`);
      const env = { HOME: home, XDG_CONFIG_HOME: xdg };
      const ssot = await readUserBunfigInstall(env);
      const effective = await readEffectiveUserBunfigInstall(env);
      expect(ssot.install?.linker).toBe("isolated");
      expect(ssot.bunfigPath).toBe(join(home, ".bunfig.toml"));
      expect(effective.bunfigPath).toBe(join(xdg, ".bunfig.toml"));
      expect(effective.install?.linker).toBe("hoisted");
    });
  });

  test("redundancy inherit compares against the XDG global when it exists", async () => {
    const project = testTempDir("bunfig-redundancy-xdg-project-");
    writeText(
      join(project, "bunfig.toml"),
      `[install]
linker = "hoisted"
`
    );

    await withUniqueHome(async (home) => {
      writeText(join(home, ".bunfig.toml"), MACHINE_BUNFIG);
      const xdg = join(home, "xdg");
      makeDir(xdg, { recursive: true });
      writeText(join(xdg, ".bunfig.toml"), `[install]\nlinker = "hoisted"\n`);
      const previousXdg = Bun.env.XDG_CONFIG_HOME;
      Bun.env.XDG_CONFIG_HOME = xdg;
      try {
        const audit = await auditWorkspaceBunfigRedundancy(project);
        expect(audit.machineBunfigPath).toBe(join(xdg, ".bunfig.toml"));
        expect(audit.hits[0]?.keys).toEqual(["[install].linker"]);
      } finally {
        if (previousXdg === undefined) delete Bun.env.XDG_CONFIG_HOME;
        else Bun.env.XDG_CONFIG_HOME = previousXdg;
      }
    });
  });
});
