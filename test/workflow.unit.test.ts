import { describe, expect, test } from "bun:test";
import { join } from "path";
import { cleanupPath, testTempDir } from "./helpers.ts";
import { computeDrift } from "../src/lib/workflow/drift.ts";
import {
  applyFixes,
  generateReport,
  sendAlert,
  type AlertPayload,
} from "../src/lib/workflow/effects.ts";
import { WorkflowLoop } from "../src/lib/workflow/loop.ts";
import { writeSeedFile } from "../src/lib/workflow/seed.ts";
import type { ScannerResult, WorkflowSeedState } from "../src/lib/workflow/types.ts";

describe("workflow", () => {
  test("computeDrift detects scanner status changes", () => {
    const seed: WorkflowSeedState = {
      domainId: "com.example.app",
      generatedAt: "2026-01-01T00:00:00.000Z",
      results: [{ scannerId: "semver", status: "ok", issues: [] }],
    };
    const current: ScannerResult[] = [
      {
        scannerId: "semver",
        status: "error",
        issues: [{ severity: "critical", message: "lodash@0.0.0 violates semver policy" }],
      },
    ];
    const drift = computeDrift(current, seed);
    expect(drift).not.toBeNull();
    expect(drift?.semver).toBeDefined();
  });

  test("sendAlert posts JSON payload to webhook", async () => {
    let captured: AlertPayload | null = null;
    const domain = { id: "com.example.app", projectRoot: "/tmp" };
    const results: ScannerResult[] = [
      { scannerId: "semver", status: "error", issues: [{ severity: "high", message: "x" }] },
    ];

    await sendAlert(domain, results, { semver: { type: "changed" } }, "https://example.test/hook", {
      fetch: async (_url, init) => {
        captured = JSON.parse(String(init?.body ?? "{}")) as AlertPayload;
        return new Response("ok", { status: 200 });
      },
      log: () => {},
    });

    expect(captured).not.toBeNull();
    expect(captured!.domain).toBe("com.example.app");
    expect(captured!.results[0]?.issues).toBe(1);
  });

  test("applyFixes spawns bun add for critical semver issues", async () => {
    const spawnCalls: string[][] = [];
    const domain = { id: "com.example.app", projectRoot: testTempDir("workflow-fix-") };

    try {
      await applyFixes(
        domain,
        [
          {
            scannerId: "semver",
            status: "error",
            issues: [
              {
                severity: "critical",
                message: "lodash@0.0.0 violates semver policy",
                package: "lodash",
                currentVersion: "0.0.0",
              },
            ],
          },
        ],
        domain.projectRoot,
        {
          findSafeVersion: async () => "4.17.21",
          spawn: (options) => {
            spawnCalls.push([...options.cmd]);
            return { exited: Promise.resolve(0) };
          },
          log: () => {},
        }
      );

      expect(spawnCalls[0]).toEqual(["bun", "add", "lodash@4.17.21"]);
    } finally {
      cleanupPath(domain.projectRoot);
    }
  });

  test("generateReport writes markdown report file", async () => {
    const dir = testTempDir("workflow-report-");
    const reportPath = join(dir, "reports", "latest.md");
    const domain = { id: "com.example.app", projectRoot: dir };

    try {
      await generateReport(
        domain,
        [{ scannerId: "semver", status: "ok", issues: [] }],
        null,
        reportPath,
        { log: () => {} }
      );
      const text = await Bun.file(reportPath).text();
      expect(text).toContain("# Workflow report: com.example.app");
      expect(text).toContain("semver");
    } finally {
      cleanupPath(dir);
    }
  });

  test("WorkflowLoop runOnce executes effects and fails on drift", async () => {
    const dir = testTempDir("workflow-loop-");
    const seedPath = join(dir, "seed.json5");
    const domain = { id: "com.example.app", projectRoot: dir };

    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "demo",
        version: "1.0.0",
        dependencies: { "bad-pkg": "0.0.0" },
      })
    );
    await writeSeedFile(seedPath, domain.id, [{ scannerId: "semver", status: "ok", issues: [] }]);

    const loop = new WorkflowLoop(domain, {
      scanners: ["semver"],
      seedPath,
      failOnDrift: true,
      effects: { report: join(dir, "report.md"), log: false },
    });

    try {
      const summary = await loop.runOnce();
      expect(summary.failed).toBe(true);
      expect(await Bun.file(join(dir, "report.md")).exists()).toBe(true);
    } finally {
      cleanupPath(dir);
    }
  });
});
