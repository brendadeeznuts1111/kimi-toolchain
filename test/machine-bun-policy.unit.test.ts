import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { join } from "path";
import {
  auditMachineBunPolicy,
  estimateEnvBlockChars,
  machineCheckFailures,
  runtimeMeetsBunMin,
} from "../src/lib/machine-bun-policy.ts";
import { signJwt, verifyJwt } from "../src/lib/jwt.ts";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import { testTempDir, withEnv } from "./helpers.ts";

const POLICY_LAYER_SECRET = "machine-bun-policy-mock-clock-secret";

function verifyTokenOrNull(token: string, secret: string) {
  try {
    return verifyJwt(token, secret);
  } catch (error) {
    if ((error as { type?: string })?.type === "jwt_expired") return null;
    throw error;
  }
}

const MACHINE_BUNFIG = `[install]
linker = "isolated"
globalStore = true
frozenLockfile = true
minimumReleaseAge = 259200

[install.cache]
dir = "/tmp/machine-bun-policy-cache"
`;

describe("machine-bun-policy", () => {
  test("n/a when ~/.bunfig.toml is absent", async () => {
    const home = testTempDir("machine-bun-na-home-");
    const audit = await auditMachineBunPolicy({ HOME: home });
    expect(audit.applicable).toBe(false);
    expect(audit.ok).toBe(true);
    expect(machineCheckFailures(audit.checks)).toHaveLength(0);
  });

  test("passes canonical machine bunfig", async () => {
    const home = testTempDir("machine-bun-pass-home-");
    writeText(join(home, ".bunfig.toml"), MACHINE_BUNFIG);
    makeDir(join(home, ".config/shell"), { recursive: true });
    writeText(join(home, ".config/shell/path.sh"), "# path\n");

    const audit = await auditMachineBunPolicy({ HOME: home });
    expect(audit.applicable).toBe(true);
    expect(audit.ok).toBe(true);
    expect(machineCheckFailures(audit.checks)).toHaveLength(0);
    expect(audit.checks.some((c) => c.id === "Bun.secrets")).toBe(true);
  });

  test("fails when linker drifts from isolated", async () => {
    const home = testTempDir("machine-bun-linker-home-");
    writeText(
      join(home, ".bunfig.toml"),
      MACHINE_BUNFIG.replace('linker = "isolated"', 'linker = "hoisted"')
    );
    makeDir(join(home, ".config/shell"), { recursive: true });
    writeText(join(home, ".config/shell/path.sh"), "# path\n");

    const audit = await auditMachineBunPolicy({ HOME: home });
    expect(audit.ok).toBe(false);
    expect(machineCheckFailures(audit.checks).some((line) => line.includes("linker"))).toBe(true);
  });

  test("runtimeMeetsBunMin accepts stable and canary 1.4 trains", () => {
    expect(runtimeMeetsBunMin("1.4.0", "1.4.0")).toBe(true);
    expect(runtimeMeetsBunMin("1.4.0-canary.1", "1.4.0")).toBe(true);
    expect(runtimeMeetsBunMin("1.3.14", "1.4.0")).toBe(false);
  });

  test("estimateEnvBlockChars sums KEY=value pairs", () => {
    expect(estimateEnvBlockChars({ A: "aa", B: "bbb" })).toBe(11);
  });

  test("windows.env-block check present only on win32", async () => {
    const home = testTempDir("machine-bun-win-env-home-");
    writeText(join(home, ".bunfig.toml"), MACHINE_BUNFIG);
    makeDir(join(home, ".config/shell"), { recursive: true });
    writeText(join(home, ".config/shell/path.sh"), "# path\n");

    const audit = await auditMachineBunPolicy({ HOME: home });
    const winCheck = audit.checks.find((c) => c.id === "windows.env-block");
    if (process.platform === "win32") {
      expect(winCheck).toBeDefined();
      expect(winCheck?.ok).toBe(runtimeMeetsBunMin(Bun.version, "1.4.0"));
    } else {
      expect(winCheck).toBeUndefined();
    }
  });

  describe("mock-clock integration (setSystemTime)", () => {
    afterEach(() => {
      setSystemTime();
    });

    test("rejects naive epoch math in favor of frozen wall clock for TTL boundaries", () => {
      // BEFORE — non-deterministic, does not prove expiry behavior:
      // const now = Math.floor(Date.now() / 1000);
      // const expires = now + 3600;
      // expect(expires > now).toBe(true);

      // AFTER — deterministic issue / pre-expiry / post-expiry:
      const issueDate = new Date("2026-06-23T00:00:00.000Z");
      setSystemTime(issueDate);

      const token = signJwt({ sub: "machine-policy", aud: "kimi-toolchain" }, POLICY_LAYER_SECRET, {
        ttlSeconds: 3600,
        audience: "kimi-toolchain",
      });

      expect(verifyTokenOrNull(token, POLICY_LAYER_SECRET)).toBeTruthy();
      expect(runtimeMeetsBunMin(Bun.version, "1.4.0")).toBe(true);

      setSystemTime(new Date("2026-06-23T00:59:59.000Z"));
      expect(verifyTokenOrNull(token, POLICY_LAYER_SECRET)).toBeTruthy();

      setSystemTime(new Date("2026-06-23T01:00:01.000Z"));
      expect(verifyTokenOrNull(token, POLICY_LAYER_SECRET)).toBeNull();
    });

    test("policy audit remains stable under frozen clock", async () => {
      const home = testTempDir("machine-bun-frozen-clock-");
      writeText(join(home, ".bunfig.toml"), MACHINE_BUNFIG);
      makeDir(join(home, ".config/shell"), { recursive: true });
      writeText(join(home, ".config/shell/path.sh"), "# path\n");

      setSystemTime(new Date("2026-06-23T12:00:00.000Z"));
      const audit = await auditMachineBunPolicy({ HOME: home });
      expect(audit.ok).toBe(true);
      expect(machineCheckFailures(audit.checks)).toHaveLength(0);
      expect(new Date().toISOString()).toBe("2026-06-23T12:00:00.000Z");
    });
  });

  test("fails when deprecated BUN_INSTALL_GLOBAL_STORE env is set", async () => {
    const home = testTempDir("machine-bun-env-home-");
    writeText(join(home, ".bunfig.toml"), MACHINE_BUNFIG);
    makeDir(join(home, ".config/shell"), { recursive: true });
    writeText(join(home, ".config/shell/path.sh"), "# path\n");

    await withEnv({ HOME: home, BUN_INSTALL_GLOBAL_STORE: "1" }, async () => {
      const audit = await auditMachineBunPolicy();
      expect(audit.ok).toBe(false);
      expect(
        machineCheckFailures(audit.checks).some((line) => line.includes("BUN_INSTALL_GLOBAL_STORE"))
      ).toBe(true);
    });
  });
});
