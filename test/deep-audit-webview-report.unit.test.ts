/**
 * webview-report.ts — HTML rendering regression guard.
 *
 * Verifies the deep-audit report HTML generation without opening a Bun.WebView
 * window (which would block the test runner). The pure `renderReportHtml` function
 * is exercised directly.
 *
 * @see src/doctor/deep-audit/webview-report.ts
 */
import { describe, expect, test } from "bun:test";
import { renderReportHtml } from "../src/doctor/deep-audit/webview-report.ts";
import type { DeepAuditReport } from "../src/lib/deep-audit-types.ts";

function sampleReport(overrides: Partial<DeepAuditReport> = {}): DeepAuditReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-22T00:00:00.000Z",
    projectRoot: "/tmp/demo",
    bunVersion: "1.4.0",
    full: false,
    runs: [
      {
        id: "verify-bun-features",
        description: "Bun feature check",
        ok: true,
        exitCode: 0,
        durationMs: 120,
        stdout: "all passed",
        stderr: "",
        summary: "all passed",
      },
      {
        id: "audit-all",
        description: "Parallel audit bundle",
        ok: false,
        exitCode: 1,
        durationMs: 340,
        stdout: "",
        stderr: "config drift detected",
        summary: "config drift detected",
      },
    ],
    summary: { total: 2, passed: 1, failed: 1, durationMs: 460 },
    ...overrides,
  };
}

describe("deep-audit-webview-report", () => {
  describe("renderReportHtml", () => {
    test("produces a complete HTML document", () => {
      const html = renderReportHtml(sampleReport());
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html.includes("</html>")).toBe(true);
      expect(html.includes("<title>Deep Audit Report")).toBe(true);
    });

    test("renders pass and fail rows", () => {
      const html = renderReportHtml(sampleReport());
      expect(html.includes('class="run pass"')).toBe(true);
      expect(html.includes('class="run fail"')).toBe(true);
      expect(html.includes("✅")).toBe(true);
      expect(html.includes("❌")).toBe(true);
    });

    test("embeds audit ids and summaries", () => {
      const html = renderReportHtml(sampleReport());
      expect(html.includes("verify-bun-features")).toBe(true);
      expect(html.includes("audit-all")).toBe(true);
      expect(html.includes("config drift detected")).toBe(true);
    });

    test("shows failure status banner when any audit fails", () => {
      const html = renderReportHtml(sampleReport());
      expect(html.includes('class="status failure"')).toBe(true);
    });

    test("shows success status banner when all audits pass", () => {
      const report = sampleReport({
        runs: [
          {
            id: "verify-bun-features",
            description: "Bun feature check",
            ok: true,
            exitCode: 0,
            durationMs: 120,
            stdout: "all passed",
            stderr: "",
            summary: "all passed",
          },
        ],
        summary: { total: 1, passed: 1, failed: 0, durationMs: 120 },
      });
      const html = renderReportHtml(report);
      expect(html.includes('class="status success"')).toBe(true);
    });

    test("escapes HTML in project root and summaries", () => {
      const report = sampleReport({
        projectRoot: "/tmp/<script>alert(1)</script>",
        runs: [
          {
            id: "xss",
            description: "escaped",
            ok: false,
            exitCode: 1,
            durationMs: 1,
            stdout: "",
            stderr: "",
            summary: "<img src=x onerror=alert(1)>",
          },
        ],
        summary: { total: 1, passed: 0, failed: 1, durationMs: 1 },
      });
      const html = renderReportHtml(report);
      expect(html.includes("<script>alert(1)</script>")).toBe(false);
      expect(html.includes("&lt;script&gt;")).toBe(true);
      expect(html.includes("<img src=x onerror=alert(1)>")).toBe(false);
      expect(html.includes("&lt;img src=x onerror=alert(1)&gt;")).toBe(true);
    });

    test("includes summary counts", () => {
      const html = renderReportHtml(sampleReport());
      expect(html.includes("1/2 passed")).toBe(true);
      expect(html.includes("1 failed")).toBe(true);
    });

    test("indicates full vs default mode", () => {
      const defaultHtml = renderReportHtml(sampleReport({ full: false }));
      const fullHtml = renderReportHtml(sampleReport({ full: true }));
      expect(defaultHtml.includes("Mode: default")).toBe(true);
      expect(fullHtml.includes("Mode: full")).toBe(true);
    });

    test("renders duration bars relative to longest run", () => {
      const html = renderReportHtml(sampleReport());
      expect(html.includes('class="duration-bar"')).toBe(true);
      expect(html.includes('class="duration-bar-bg"')).toBe(true);
      expect(html.includes('style="width: 100.0%"')).toBe(true);
    });

    test("renders toolbar with search and download button", () => {
      const html = renderReportHtml(sampleReport());
      expect(html.includes('id="run-search"')).toBe(true);
      expect(html.includes('id="download-json"')).toBe(true);
      expect(html.includes('type="search"')).toBe(true);
    });

    test("embeds report data for download script", () => {
      const html = renderReportHtml(sampleReport());
      expect(html.includes('id="report-data"')).toBe(true);
      expect(html.includes('"projectRoot":"/tmp/demo"')).toBe(true);
    });

    test("renders expandable details with stdout and stderr", () => {
      const html = renderReportHtml(sampleReport());
      expect(html.includes("<details>")).toBe(true);
      expect(html.includes("<summary>Details</summary>")).toBe(true);
      expect(html.includes("all passed")).toBe(true);
      expect(html.includes("config drift detected")).toBe(true);
    });

    test("escapes HTML in stdout and stderr details", () => {
      const report = sampleReport({
        runs: [
          {
            id: "xss",
            description: "escaped",
            ok: false,
            exitCode: 1,
            durationMs: 1,
            stdout: "<script>alert(1)</script>",
            stderr: "<img src=x onerror=alert(1)>",
            summary: "xss",
          },
        ],
        summary: { total: 1, passed: 0, failed: 1, durationMs: 1 },
      });
      const html = renderReportHtml(report);
      expect(html.includes("<script>alert(1)</script>")).toBe(false);
      expect(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe(true);
      expect(html.includes("<img src=x onerror=alert(1)>")).toBe(false);
      expect(html.includes("&lt;img src=x onerror=alert(1)&gt;")).toBe(true);
    });
  });
});
