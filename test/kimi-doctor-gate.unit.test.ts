/** @description kimi-doctor --gate dependency resolution and --gate-graph output. */

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { ArtifactStore } from "../src/lib/artifact-store.ts";
import { writeText } from "../src/lib/bun-io.ts";
import {
  CLEAN_INSTALL_AUDIT_ENV,
  cleanupPath,
  REPO_ROOT,
  spawnCaptured,
  testTempDir,
} from "./helpers.ts";

const GATE_TEST_MS = 8_000;

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
globalStore = true
globalDir = "~/.bun/install/global"
globalBinDir = "~/.bun/bin"
minimumReleaseAge = 259200
minimumReleaseAgeExcludes = ["@types/bun", "@types/node", "typescript"]

[install.cache]
disable = false
disableManifest = false
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
  test(
    "--gate bunfig-policy returns dependency order in JSON",
    async () => {
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
        { cwd: REPO_ROOT, env: CLEAN_INSTALL_AUDIT_ENV }
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
      // Isolated fixture may warn when machine ~/.bunfig.toml diverges from project bunfig
      expect(["pass", "warn"]).toContain(payload.results[0]?.status ?? "");
    },
    GATE_TEST_MS
  );

  test(
    "--dryrun prints gate order without executing",
    async () => {
      const result = await spawnCaptured(
        ["bun", "run", "src/bin/kimi-doctor.ts", "--gate", "perf-gate", "--dryrun", "--json"],
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
    },
    GATE_TEST_MS
  );

  test(
    "--artifacts-lineage flag traces metadata.lineage",
    async () => {
      const dir = testTempDir("kimi-doctor-artifacts-lineage-flag-");
      const store = new ArtifactStore(dir);
      const upstreamPath = await store.save("bunfig-policy", { status: "pass" });
      await store.save(
        "perf-gate",
        { status: "pass" },
        {
          lineage: {
            dependencies: ["bunfig-policy"],
            upstreamArtifacts: [store.relativePath(upstreamPath)],
          },
        }
      );

      const result = await spawnCaptured(
        [
          "bun",
          "run",
          "src/bin/kimi-doctor.ts",
          "--artifacts-lineage",
          "perf-gate",
          "--project-root",
          dir,
          "--json",
        ],
        { cwd: REPO_ROOT }
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        mode: string;
        lineageSource: string;
        lineage?: { dependencies: string[] };
      };
      expect(payload.mode).toBe("artifacts-lineage");
      expect(payload.lineageSource).toBe("runtime");
      expect(payload.lineage?.dependencies).toEqual(["bunfig-policy"]);
      cleanupPath(dir);
    },
    GATE_TEST_MS
  );

  test(
    "artifacts lineage subcommand traces upstream dependencies",
    async () => {
      const dir = testTempDir("kimi-doctor-artifacts-lineage-");
      const store = new ArtifactStore(dir);
      const upstreamPath = await store.save("bunfig-policy", { status: "pass" });
      await store.save(
        "perf-gate",
        { status: "pass" },
        {
          lineage: {
            dependencies: ["bunfig-policy"],
            upstreamArtifacts: [store.relativePath(upstreamPath)],
          },
        }
      );

      const result = await spawnCaptured(
        [
          "bun",
          "run",
          "src/bin/kimi-doctor.ts",
          "artifacts",
          "lineage",
          "perf-gate",
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
        lineageSource: string;
        lineage?: { dependencies: string[]; upstreamArtifacts: string[] };
      };
      expect(payload.mode).toBe("artifacts-lineage");
      expect(payload.gate).toBe("perf-gate");
      expect(payload.lineageSource).toBe("runtime");
      expect(payload.lineage?.dependencies).toEqual(["bunfig-policy"]);
      cleanupPath(dir);
    },
    GATE_TEST_MS
  );

  test(
    "--artifact-graph emits Mermaid lineage for saved artifact",
    async () => {
      const dir = testTempDir("kimi-doctor-artifact-graph-");
      const store = new ArtifactStore(dir);
      await store.save("strategy-performance", { pnl: 1 });
      await store.save(
        "model-drift",
        { drift: 0.1 },
        { dependsOn: [{ gate: "strategy-performance", limit: 1 }] }
      );

      const result = await spawnCaptured(
        [
          "bun",
          "run",
          "src/bin/kimi-doctor.ts",
          "--artifact-graph",
          "model-drift",
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
        mermaid: string;
        stored: boolean;
      };
      expect(payload.mode).toBe("artifact-graph");
      expect(payload.gate).toBe("model-drift");
      expect(payload.stored).toBe(true);
      expect(payload.mermaid).toContain("graph TD");
      expect(payload.mermaid).toContain("strategy-performance");
      cleanupPath(dir);
    },
    GATE_TEST_MS
  );

  test(
    "--gate-graph emits Mermaid for a gate closure",
    async () => {
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
    },
    GATE_TEST_MS
  );

  test(
    "--gate perf-gate JSON includes autoResolved when dependencies expand",
    async () => {
      const result = await spawnCaptured(
        ["bun", "run", "src/bin/kimi-doctor.ts", "--gate", "perf-gate", "--dryrun", "--json"],
        { cwd: REPO_ROOT }
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        gate: string;
        order: string[];
        autoResolved?: string[];
      };
      expect(payload.gate).toBe("perf-gate");
      expect(payload.order).toEqual(["bunfig-policy", "perf-gate"]);
      expect(payload.autoResolved).toEqual(["bunfig-policy"]);
    },
    GATE_TEST_MS
  );

  test(
    "--gate perf-gate runs bunfig-policy before blocking on failure",
    async () => {
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
    },
    GATE_TEST_MS
  );
});
