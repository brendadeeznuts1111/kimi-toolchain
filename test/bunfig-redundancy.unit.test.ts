import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import { auditWorkspaceBunfigRedundancy } from "../src/lib/bunfig-redundancy.ts";
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
});
