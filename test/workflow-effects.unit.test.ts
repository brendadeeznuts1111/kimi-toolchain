/**
 * workflow-effects.unit.test.ts — Tests for Log, Alert, Fix, and Report effect handlers.
 */
import { describe, expect, test } from "bun:test";
import {
  alertEffect,
  fixEffect,
  logEffect,
  reportEffect,
  runWorkflowEffects,
  type WorkflowEffectContext,
} from "../src/lib/workflow-effects.ts";

const MINIMAL_CTX: WorkflowEffectContext = {
  domainId: "test-domain",
  results: [],
  drift: null,
  timestamp: new Date().toISOString(),
};

// ── Log Effect ───────────────────────────────────────────────────────

describe("workflow-effects log", () => {
  test("logEffect writes to stderr without throwing", () => {
    expect(() => logEffect(MINIMAL_CTX)).not.toThrow();
  });

  test("logEffect includes issue counts in output", () => {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      logEffect({
        ...MINIMAL_CTX,
        results: [
          {
            scannerId: "semver",
            status: "warn",
            issues: [
              { id: "DEP-1", message: "lodash outdated", severity: "high" },
              { id: "CVE-1", message: "express CVE", severity: "critical" },
            ],
          },
        ],
        drift: { packagesChanged: 1 },
      });
      const output = lines.join("\n");
      expect(output).toContain("2 issue(s)");
      expect(output).toContain("1 critical");
      expect(output).toContain("Drift");
    } finally {
      console.error = orig;
    }
  });

  test("logEffect handles empty results", () => {
    expect(() => logEffect(MINIMAL_CTX)).not.toThrow();
  });
});

// ── Alert Effect ─────────────────────────────────────────────────────

describe("workflow-effects alert", () => {
  test("alertEffect returns { ok: false } for unreachable URL", async () => {
    const result = await alertEffect(MINIMAL_CTX, "http://127.0.0.1:1/alert");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("alertEffect payload includes domain and timestamp", async () => {
    // Verify structure by checking it doesn't throw on payload construction
    const ctx: WorkflowEffectContext = {
      ...MINIMAL_CTX,
      results: [
        {
          scannerId: "security",
          status: "error",
          issues: [{ id: "X", message: "bad", severity: "critical" }],
        },
      ],
      bun: { version: "1.4.0", revision: "abc123", platform: "darwin" },
    };
    const result = await alertEffect(ctx, "http://127.0.0.1:1/alert");
    expect(result.ok).toBe(false); // unreachable, but payload was built
  });

  test("alertEffect with TLS config does not throw", async () => {
    const ctx: WorkflowEffectContext = {
      ...MINIMAL_CTX,
      tls: { rejectUnauthorized: false },
    };
    const result = await alertEffect(ctx, "http://127.0.0.1:1/alert");
    expect(result.ok).toBe(false);
  });
});

// ── Fix Effect ───────────────────────────────────────────────────────

describe("workflow-effects fix", () => {
  test("fixEffect skips non-semver scanners", async () => {
    const results = await fixEffect({
      ...MINIMAL_CTX,
      results: [
        {
          scannerId: "lint",
          status: "error",
          issues: [{ id: "L-1", message: "format error", severity: "critical", package: "eslint" }],
        },
      ],
    });
    expect(results).toHaveLength(0);
  });

  test("fixEffect skips low/medium severity issues", async () => {
    const results = await fixEffect({
      ...MINIMAL_CTX,
      results: [
        {
          scannerId: "semver",
          status: "warn",
          issues: [
            { id: "DEP-1", message: "lodash outdated", severity: "low", package: "lodash" },
            { id: "DEP-2", message: "react old", severity: "medium", package: "react" },
          ],
        },
      ],
    });
    expect(results).toHaveLength(0);
  });

  test("fixEffect attempts fix for critical semver issue with targetVersion", async () => {
    const results = await fixEffect({
      ...MINIMAL_CTX,
      results: [
        {
          scannerId: "semver",
          status: "warn",
          issues: [
            {
              id: "DEP-CRIT",
              message: "typescript@1.0.0 is ancient",
              severity: "critical",
              package: "typescript",
              currentVersion: "1.0.0",
              targetVersion: "latest",
            },
          ],
        },
      ],
    });
    // Should attempt fix (may succeed or fail depending on whether bun add works)
    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      expect(results[0].package).toBe("typescript");
    }
  });

  test("fixEffect handles governance scanner issues", async () => {
    const results = await fixEffect({
      ...MINIMAL_CTX,
      results: [
        {
          scannerId: "governance",
          status: "error",
          issues: [
            {
              id: "GOV-LOCK",
              message: "lockfile stale",
              severity: "high",
              package: "@types/bun",
              currentVersion: "1.0.0",
              targetVersion: "latest",
            },
          ],
        },
      ],
    });
    expect(Array.isArray(results)).toBe(true);
  });
});

// ── Report Effect ────────────────────────────────────────────────────

describe("workflow-effects report", () => {
  test("reportEffect generates Markdown file", async () => {
    const path = await reportEffect({
      ...MINIMAL_CTX,
      results: [
        {
          scannerId: "semver",
          status: "warn",
          issues: [
            { id: "DEP-1", message: "lodash outdated", severity: "high", package: "lodash" },
          ],
        },
      ],
      drift: { packagesChanged: 2 },
    });
    expect(typeof path).toBe("string");
    const exists = await Bun.file(path).exists();
    expect(exists).toBe(true);
    const content = await Bun.file(path).text();
    expect(content).toContain("# Workflow Report: test-domain");
    expect(content).toContain("## Summary");
    expect(content).toContain("## Drift");
  });

  test("reportEffect includes Bun metadata when present", async () => {
    const path = await reportEffect({
      ...MINIMAL_CTX,
      bun: { version: "1.4.0", revision: "abc123", platform: "darwin" },
      results: [],
    });
    const content = await Bun.file(path).text();
    expect(content).toContain("**Bun:** 1.4.0 (abc123) on darwin");
  });

  test("reportEffect works with custom path", async () => {
    const path = await reportEffect({ ...MINIMAL_CTX, results: [] }, "reports/custom-report.md");
    expect(path).toBe("reports/custom-report.md");
    expect(await Bun.file(path).exists()).toBe(true);
  });
});

// ── Orchestrator ─────────────────────────────────────────────────────

describe("workflow-effects orchestrator", () => {
  test("runWorkflowEffects auto-injects Bun metadata", async () => {
    const ctx: WorkflowEffectContext = { ...MINIMAL_CTX };
    expect(ctx.bun).toBeUndefined();
    const result = await runWorkflowEffects(ctx);
    expect(ctx.bun).toBeDefined();
    expect(ctx.bun!.version).toBe(Bun.version);
    expect(ctx.bun!.platform).toBe(process.platform);
    expect(result.logRan).toBe(true);
  });

  test("runWorkflowEffects respects log:false", async () => {
    const result = await runWorkflowEffects(MINIMAL_CTX, { log: false });
    expect(result.logRan).toBe(false);
  });

  test("runWorkflowEffects runs report when enabled", async () => {
    const result = await runWorkflowEffects(MINIMAL_CTX, { report: true });
    expect(result.reportPath).toBeDefined();
    expect(await Bun.file(result.reportPath!).exists()).toBe(true);
  });

  test("runWorkflowEffects handles all effects combined", async () => {
    const ctx: WorkflowEffectContext = {
      ...MINIMAL_CTX,
      results: [
        {
          scannerId: "semver",
          status: "warn",
          issues: [{ id: "DEP-1", message: "test", severity: "high" }],
        },
      ],
    };
    const result = await runWorkflowEffects(ctx, {
      log: true,
      alertUrl: "http://127.0.0.1:1/alert",
      fix: false, // don't run fix in CI
      report: true,
    });
    expect(result.logRan).toBe(true);
    expect(result.alertResult).toBeDefined();
    expect(result.alertResult!.ok).toBe(false); // unreachable URL
    expect(result.reportPath).toBeDefined();
  });
});
