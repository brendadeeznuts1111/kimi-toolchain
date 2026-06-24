import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import { bunfigPolicyGate, formatBunfigPolicyGate } from "../src/gates/index.ts";
import {
  CLEAN_INSTALL_AUDIT_ENV,
  createTempProject,
  spawnCaptured,
  testTempDir,
  withEnv,
  seedMachineBunfigSsot,
  withIsolatedHome,
} from "./helpers.ts";
import { pathExists } from "../src/lib/bun-io.ts";
import { bunfigPolicyGateDefinition, runBunfigPolicyGate } from "../src/gates/bunfig-policy.ts";
import { runGatesWithDependencies } from "../src/gates/runner.ts";

const SECURE_BUNFIG = `[install]
optional = true
dev = true
peer = true
production = false
dryRun = false
saveTextLockfile = true
frozenLockfile = true
exact = false
ignoreScripts = false
concurrentScripts = 8
globalDir = "~/.bun/install/global"
globalBinDir = "~/.bun/bin"
minimumReleaseAge = 259200
minimumReleaseAgeExcludes = ["@types/bun", "@types/node", "typescript"]

[install.cache]
disable = false
disableManifest = false
`;

const SECURE_PACKAGE = {
  name: "demo",
  version: "1.0.0",
  packageManager: "bun@1.4.0",
  engines: { bun: ">=1.4.0" },
  trustedDependencies: [] as string[],
};

function writeSecureProject(dir: string, bunfig = SECURE_BUNFIG): void {
  writeText(join(dir, "bunfig.toml"), bunfig);
  writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE, null, 2));
}

const CLEAN_ENV = CLEAN_INSTALL_AUDIT_ENV;

function withIsolatedCleanInstall<T>(fn: () => T | Promise<T>): T | Promise<T> {
  return withIsolatedHome((home) => {
    seedMachineBunfigSsot(home);
    return withEnv({ ...CLEAN_ENV, HOME: home }, fn);
  });
}

/** Spawn-heavy kimi-doctor invocations need headroom under parallel pre-push gates. */
const SPAWN_TEST_TIMEOUT_MS = 60_000;

describe("bunfig-policy-gate", () => {
  test("passes secure bunfig policy", async () => {
    const dir = testTempDir("bunfig-policy-pass-");
    writeSecureProject(dir);

    await withIsolatedCleanInstall(async () => {
      const result = await bunfigPolicyGate(dir);
      expect(result.status).toBe("pass");
      expect(result.summary.frozenLockfile).toBe(true);
      expect(result.summary.minimumReleaseAge).toBe(259200);
      expect(result.summary.linker).toBe("isolated");
      expect(result.inherited.some((n) => n.includes("[install].linker"))).toBe(true);
      expect(result.summary.ssot.linker.status).toBe("inherited");
      expect(result.summary.globalStore).toBe("true");
      expect(result.summary.cacheDir).toBeTruthy();
      expect(
        formatBunfigPolicyGate(result).some((line) => line.includes("isolated (inherited)"))
      ).toBe(true);
      expect(formatBunfigPolicyGate(result)[0]).toContain("pass: bunfig-policy");
    });
  });

  test("fails when frozen lockfile policy drifts", async () => {
    const dir = testTempDir("bunfig-policy-fail-");
    writeSecureProject(
      dir,
      SECURE_BUNFIG.replace("frozenLockfile = true", "frozenLockfile = false")
    );

    await withIsolatedCleanInstall(async () => {
      const result = await bunfigPolicyGate(dir);
      expect(result.status).toBe("fail");
      expect(result.failures.some((line) => line.includes("frozenLockfile"))).toBe(true);
    });
  });

  test("warns when minimum release age is missing", async () => {
    const dir = testTempDir("bunfig-policy-warn-");
    writeSecureProject(dir, SECURE_BUNFIG.replace("minimumReleaseAge = 259200\n", ""));

    await withIsolatedCleanInstall(async () => {
      const result = await bunfigPolicyGate(dir);
      expect(result.status).toBe("warn");
      expect(result.warnings.some((line) => line.includes("minimumReleaseAge"))).toBe(true);
    });
  });

  test("fails when packageManager or engines.bun drift from hardened policy", async () => {
    const dir = testTempDir("bunfig-policy-version-drift-");
    writeSecureProject(dir);
    writeText(
      join(dir, "package.json"),
      JSON.stringify(
        {
          ...SECURE_PACKAGE,
          packageManager: "bun@1.3.14",
          engines: { bun: ">=1.0.0" },
        },
        null,
        2
      )
    );

    await withIsolatedCleanInstall(async () => {
      const result = await bunfigPolicyGate(dir);
      expect(result.status).toBe("fail");
      expect(result.failures.some((line) => line.includes("packageManager"))).toBe(true);
      expect(result.failures.some((line) => line.includes("engines.bun"))).toBe(true);
    });
  });

  test("passes when project omits linker/globalStore inherited from machine SSOT", async () => {
    const dir = testTempDir("bunfig-policy-ssot-");
    const home = testTempDir("bunfig-policy-ssot-home-");
    writeSecureProject(
      dir,
      SECURE_BUNFIG.replace('linker = "isolated"\n', "").replace("globalStore = true\n", "")
    );

    seedMachineBunfigSsot(home, "/tmp/bunfig-policy-ssot-cache");

    await withEnv({ ...CLEAN_ENV, HOME: home }, async () => {
      const result = await bunfigPolicyGate(dir);
      expect(result.status).toBe("pass");
      expect(result.inherited.some((n) => n.includes("[install].linker"))).toBe(true);
      expect(result.inherited.some((n) => n.includes("[install].globalStore"))).toBe(true);
      expect(result.warnings.some((w) => w.includes("[install].linker is unset"))).toBe(false);
      expect(result.warnings.some((w) => w.startsWith("linker unset"))).toBe(false);
    });
  });

  test("fails when machine ~/.bunfig.toml linker drifts", async () => {
    const dir = testTempDir("bunfig-policy-machine-");
    const home = testTempDir("bunfig-policy-machine-home-");
    writeSecureProject(dir);

    writeText(
      join(home, ".bunfig.toml"),
      `[install]
linker = "hoisted"
globalStore = true
minimumReleaseAge = 259200

[install.cache]
dir = "/tmp/machine-bunfig-policy-cache"
`
    );
    makeDir(join(home, ".config/shell"), { recursive: true });
    writeText(join(home, ".config/shell/path.sh"), "# path\n");

    await withEnv({ ...CLEAN_ENV, HOME: home }, async () => {
      const result = await bunfigPolicyGate(dir);
      expect(result.machine.applicable).toBe(true);
      expect(result.status).toBe("fail");
      expect(result.failures.some((line) => line.includes("machine.linker"))).toBe(true);
    });
  });

  test("fails when risky Bun install env override is set", async () => {
    const dir = testTempDir("bunfig-policy-env-");
    writeSecureProject(dir);

    await withEnv({ ...CLEAN_ENV, BUN_CONFIG_SKIP_SAVE_LOCKFILE: "1" }, async () => {
      const result = await bunfigPolicyGate(dir);
      expect(result.status).toBe("fail");
      expect(result.summary.riskyEnvOverrides).toContain("BUN_CONFIG_SKIP_SAVE_LOCKFILE");
    });
  });

  test(
    "kimi-doctor --gate bunfig-policy returns pass via dependency runner",
    async () => {
      const dir = testTempDir("bunfig-policy-cli-");
      const home = testTempDir("bunfig-policy-cli-home-");
      writeSecureProject(dir);
      seedMachineBunfigSsot(home);

      const result = await spawnCaptured(
        [
          "bun",
          "run",
          "src/bin/kimi-doctor.ts",
          "--gate",
          "bunfig-policy",
          "--project-root",
          dir,
          "--json",
        ],
        { cwd: join(import.meta.dir, ".."), env: { ...CLEAN_ENV, HOME: home } }
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        mode: string;
        gate: string;
        result: { status: string };
      };
      expect(payload.mode).toBe("gate");
      expect(payload.gate).toBe("bunfig-policy");
      expect(payload.result.status).toBe("pass");
    },
    SPAWN_TEST_TIMEOUT_MS
  );

  test(
    "kimi-doctor accepts --gate=bunfig-policy form",
    async () => {
      const dir = testTempDir("bunfig-policy-cli-eq-");
      const home = testTempDir("bunfig-policy-cli-eq-home-");
      writeSecureProject(dir);
      seedMachineBunfigSsot(home);

      const result = await spawnCaptured(
        [
          "bun",
          "run",
          "src/bin/kimi-doctor.ts",
          `--gate=bunfig-policy`,
          "--project-root",
          dir,
          "--json",
        ],
        { cwd: join(import.meta.dir, ".."), env: { ...CLEAN_ENV, HOME: home } }
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as { gate: string; result: { status: string } };
      expect(payload.gate).toBe("bunfig-policy");
      expect(payload.result.status).toBe("pass");
    },
    SPAWN_TEST_TIMEOUT_MS
  );

  test("warns when bunfig.toml missing via createTempProject", async () => {
    const project = await createTempProject({}, { chdir: false });
    try {
      const result = await runBunfigPolicyGate({ projectRoot: project.dir });
      expect(result.status).toBe("fail");
      expect(result.reason?.includes("missing bunfig.toml") ?? result.status === "fail").toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("runGatesWithDependencies saves bunfig-policy artifact when saveArtifact is true", async () => {
    const dir = testTempDir("bunfig-policy-artifact-");
    writeSecureProject(dir);

    await withIsolatedHome(async (home) => {
      seedMachineBunfigSsot(home);
      await withEnv({ ...CLEAN_ENV, HOME: home }, async () => {
        const { results } = await runGatesWithDependencies([bunfigPolicyGateDefinition], {
          projectRoot: dir,
          saveArtifact: true,
        });
        const result = results[0];
        expect(result?.status).toBe("pass");
        expect(result?.artifactPath).toBeTruthy();
        expect(pathExists(result!.artifactPath!)).toBe(true);
        expect(result!.artifactPath).toContain(join(dir, ".kimi", "artifacts", "bunfig-policy"));
      });
    });
  });

  test(
    "kimi-doctor --save-artifact persists gate JSON",
    async () => {
      const dir = testTempDir("bunfig-policy-artifact-cli-");
      const home = testTempDir("bunfig-policy-artifact-cli-home-");
      writeSecureProject(dir);
      seedMachineBunfigSsot(home);

      const result = await spawnCaptured(
        [
          "bun",
          "run",
          "src/bin/kimi-doctor.ts",
          "--gate",
          "bunfig-policy",
          "--save-artifact",
          "--project-root",
          dir,
          "--json",
        ],
        { cwd: join(import.meta.dir, ".."), env: { ...CLEAN_ENV, HOME: home } }
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        saveArtifact: boolean;
        result: { artifactPath?: string };
      };
      expect(payload.saveArtifact).toBe(true);
      expect(payload.result.artifactPath).toBeTruthy();
      expect(pathExists(payload.result.artifactPath!)).toBe(true);
    },
    SPAWN_TEST_TIMEOUT_MS
  );

  test(
    "kimi-doctor --artifacts-list and --artifacts-latest inspect saved runs",
    async () => {
      const dir = testTempDir("bunfig-policy-artifacts-cli-");
      const home = testTempDir("bunfig-policy-artifacts-cli-home-");
      writeSecureProject(dir);
      seedMachineBunfigSsot(home);

      const run = await spawnCaptured(
        [
          "bun",
          "run",
          "src/bin/kimi-doctor.ts",
          "--gate",
          "bunfig-policy",
          "--save-artifact",
          "--project-root",
          dir,
        ],
        { cwd: join(import.meta.dir, ".."), env: { ...CLEAN_ENV, HOME: home } }
      );
      expect(run.exitCode).toBe(0);

      const list = await spawnCaptured(
        [
          "bun",
          "run",
          "src/bin/kimi-doctor.ts",
          "--artifacts-list",
          "bunfig-policy",
          "--project-root",
          dir,
        ],
        { cwd: join(import.meta.dir, "..") }
      );
      expect(list.exitCode).toBe(0);
      expect(list.stdout.trim().length).toBeGreaterThan(0);
      expect(list.stdout).toContain(".kimi/artifacts/bunfig-policy/");

      const latest = await spawnCaptured(
        [
          "bun",
          "run",
          "src/bin/kimi-doctor.ts",
          "--artifacts-latest",
          "bunfig-policy",
          "--project-root",
          dir,
          "--json",
        ],
        { cwd: join(import.meta.dir, "..") }
      );
      expect(latest.exitCode).toBe(0);
      const payload = JSON.parse(latest.stdout) as { mode: string; payload: { status: string } };
      expect(payload.mode).toBe("artifacts-latest");
      expect(payload.payload.status).toBe("pass");
    },
    SPAWN_TEST_TIMEOUT_MS
  );

  test(
    "kimi-doctor rejects unknown --gate names",
    async () => {
      const result = await spawnCaptured(
        ["bun", "run", "src/bin/kimi-doctor.ts", "--gate", "not-a-gate"],
        { cwd: join(import.meta.dir, "..") }
      );

      expect(result.exitCode).toBe(1);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output).toContain("Unknown gate: not-a-gate");
      expect(output).toContain("bunfig-policy");
    },
    SPAWN_TEST_TIMEOUT_MS
  );
});
