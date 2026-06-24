import { describe, expect, test } from "bun:test";
import { join } from "path";
import { writeText } from "../src/lib/bun-io.ts";
import {
  buildSsotSummary,
  formatSsotDisplayValue,
  inheritedSsotNotes,
  resolveMachineInstallSsot,
  ssotEntry,
  ssotSatisfiesInstallPolicy,
  suppressInheritedSsotWarning,
} from "../src/lib/machine-bun-ssot.ts";
import { readUserBunfigInstall } from "../src/lib/bunfig-redundancy.ts";
import { testTempDir } from "./helpers.ts";

const MACHINE_BUNFIG = `[install]
linker = "isolated"
globalStore = true

[install.cache]
dir = "/tmp/ssot-machine-cache"
`;

describe("machine-bun-ssot", () => {
  test("marks linker and globalStore inherited when project omits them", async () => {
    const home = testTempDir("ssot-home-");
    writeText(join(home, ".bunfig.toml"), MACHINE_BUNFIG);

    await readUserBunfigInstall();
    const prevHome = Bun.env.HOME;
    Bun.env.HOME = home;
    try {
      const machineAtHome = await readUserBunfigInstall();
      const projectInstall = {
        frozenLockfile: true,
        minimumReleaseAge: 259200,
      };
      const ssot = resolveMachineInstallSsot(projectInstall, machineAtHome);
      const inherited = inheritedSsotNotes(ssot);

      expect(ssot.find((e) => e.key === "linker")?.status).toBe("inherited");
      expect(ssot.find((e) => e.key === "globalStore")?.status).toBe("inherited");
      expect(ssot.find((e) => e.key === "cacheDir")?.status).toBe("inherited");
      expect(inherited).toHaveLength(3);
      expect(
        suppressInheritedSsotWarning("linker unset — hardened isolated ([install].linker)", ssot)
      ).toBe(true);
    } finally {
      if (prevHome === undefined) delete Bun.env.HOME;
      else Bun.env.HOME = prevHome;
    }
  });

  test("buildSsotSummary and formatSsotDisplayValue expose status tags", async () => {
    const home = testTempDir("ssot-summary-home-");
    writeText(join(home, ".bunfig.toml"), MACHINE_BUNFIG);
    const prevHome = Bun.env.HOME;
    Bun.env.HOME = home;
    try {
      const machineAtHome = await readUserBunfigInstall();
      const ssot = resolveMachineInstallSsot({ frozenLockfile: true }, machineAtHome);
      const summary = buildSsotSummary(ssot);
      expect(summary.linker.status).toBe("inherited");
      expect(summary.globalStore.status).toBe("inherited");
      expect(summary.cacheDir.status).toBe("inherited");
      expect(formatSsotDisplayValue(ssotEntry(ssot, "linker"))).toBe("isolated (inherited)");
      expect(ssotSatisfiesInstallPolicy(ssot, "linker")).toBe(true);
    } finally {
      if (prevHome === undefined) delete Bun.env.HOME;
      else Bun.env.HOME = prevHome;
    }
  });

  test("detects project override vs machine", async () => {
    const home = testTempDir("ssot-override-home-");
    writeText(join(home, ".bunfig.toml"), MACHINE_BUNFIG);
    const prevHome = Bun.env.HOME;
    Bun.env.HOME = home;
    try {
      const machineAtHome = await readUserBunfigInstall();
      const ssot = resolveMachineInstallSsot({ linker: "hoisted" }, machineAtHome);
      expect(ssot.find((e) => e.key === "linker")?.status).toBe("override");
    } finally {
      if (prevHome === undefined) delete Bun.env.HOME;
      else Bun.env.HOME = prevHome;
    }
  });
});
