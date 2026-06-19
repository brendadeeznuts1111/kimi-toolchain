/** @description kimi-doctor --gate dependency resolution and --gate-graph output. */

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { writeText } from "../src/lib/bun-io.ts";
import { REPO_ROOT, spawnCaptured, testTempDir } from "./helpers.ts";

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
linker = "isolated"
globalDir = "~/.bun/install/global"
globalBinDir = "~/.bun/bin"
minimumReleaseAge = 259200
minimumReleaseAgeExcludes = ["@types/bun", "@types/node", "typescript"]

[install.cache]
dir = "~/.bun/install/cache"
`;

function writeSecureProject(dir: string): void {
  writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
  writeText(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "demo",
        version: "1.0.0",
        packageManager: "bun@1.4.0",
        engines: { bun: ">=1.4.0" },
        trustedDependencies: [] as string[],
      },
      null,
      2
    )
  );
}

describe("kimi-doctor-gate", () => {
  test("--gate bunfig-policy returns dependency order in JSON", async () => {
    const dir = testTempDir("kimi-doctor-gate-bunfig-");
    writeSecureProject(dir);

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
      { cwd: REPO_ROOT }
    );

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      mode: string;
      gate: string;
      order: string[];
      results: Array<{ gate: string; status: string }>;
    };
    expect(payload.mode).toBe("gate");
    expect(payload.gate).toBe("bunfig-policy");
    expect(payload.order).toEqual(["bunfig-policy"]);
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]?.status).toBe("pass");
  });

  test("--dryrun prints gate order without executing", async () => {
    const result = await spawnCaptured(
      [
        "bun",
        "run",
        "src/bin/kimi-doctor.ts",
        "--gate",
        "perf-gate",
        "--dryrun",
        "--json",
      ],
      { cwd: REPO_ROOT }
    );

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      mode: string;
      dryrun: boolean;
      gate: string;
      order: string[];
      gates: Array<{ name: string; dependsOn: string[] }>;
    };
    expect(payload.mode).toBe("gate");
    expect(payload.dryrun).toBe(true);
    expect(payload.gate).toBe("perf-gate");
    expect(payload.order).toEqual(["bunfig-policy", "perf-gate"]);
    expect(payload.gates.map((g) => g.name)).toEqual(["bunfig-policy", "perf-gate"]);
  });

  test("--gate-graph emits Mermaid for a gate closure", async () => {
    const result = await spawnCaptured(
      ["bun", "run", "src/bin/kimi-doctor.ts", "--gate", "perf-gate", "--gate-graph", "--json"],
      { cwd: REPO_ROOT }
    );

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      mode: string;
      gate: string;
      mermaid: string;
      gates: Array<{ name: string; dependsOn: string[] }>;
    };
    expect(payload.mode).toBe("gate-graph");
    expect(payload.gate).toBe("perf-gate");
    expect(payload.gates.map((g) => g.name)).toEqual(["bunfig-policy", "perf-gate"]);
    expect(payload.mermaid).toContain("bunfig-policy[bunfig-policy] --> perf-gate[perf-gate]");
  });

  test("--gate perf-gate runs bunfig-policy before blocking on failure", async () => {
    const dir = testTempDir("kimi-doctor-gate-blocked-");

    const result = await spawnCaptured(
      [
        "bun",
        "run",
        "src/bin/kimi-doctor.ts",
        "--gate",
        "perf-gate",
        "--project-root",
        dir,
        "--json",
      ],
      { cwd: REPO_ROOT }
    );

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout) as {
      order: string[];
      results: Array<{ gate: string; status: string; reason?: string }>;
    };
    expect(payload.order).toEqual(["bunfig-policy", "perf-gate"]);
    expect(payload.results[0]?.status).toBe("fail");
    expect(payload.results[1]).toMatchObject({
      gate: "perf-gate",
      status: "blocked",
      reason: "blocked by: bunfig-policy",
    });
  });
});
