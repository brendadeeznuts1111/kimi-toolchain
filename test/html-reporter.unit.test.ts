/** @description HTML reporter escaping and rendering. */

import { describe, expect, test } from "bun:test";
import { generatePerfHtml, type Metric } from "../src/harness/html-reporter.ts";

describe("html-reporter", () => {
  test("escapes XSS payloads in metric fields", () => {
    const metrics: Metric[] = [
      {
        symbol: "Symbol(<script>alert(1)</script>)",
        operation: "alert('xss')",
        actualMs: 1.5,
        thresholdMs: 2,
        pass: true,
        registryKey: "<img src=x onerror=alert(1)>",
        skipped: false,
        skipReason: '" onmouseover="alert(2)',
      },
      {
        symbol: "safe.op",
        operation: "alert('xss')",
        actualMs: 0.5,
        thresholdMs: 1,
        pass: true,
      },
    ];

    const html = generatePerfHtml(metrics, "<script>title</script>");

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("alert(&#x27;xss&#x27;)");
    expect(html).toContain('title="&quot; onmouseover=&quot;alert(2)"');
  });

  test("escapes meta fields", () => {
    const html = generatePerfHtml(
      [
        {
          symbol: "crypto.sha256",
          operation: "hash",
          actualMs: 1,
          thresholdMs: 2,
          pass: true,
        },
      ],
      "Report",
      {
        generatedAt: "<b>now</b>",
        gitHead: "<script>abc1234</script>",
        snapshotCount: 5,
        regressionCount: 1,
      }
    );

    expect(html).not.toContain("<b>now</b>");
    expect(html).toContain("&lt;b&gt;now&lt;/b&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script");
    expect(html).toContain("History snapshots: 5");
    expect(html).toContain("Regressions: 1");
  });

  test("renders skipped metrics with escaped reason", () => {
    const html = generatePerfHtml([
      {
        symbol: "skip.me",
        operation: "op",
        actualMs: 0,
        thresholdMs: 1,
        pass: true,
        skipped: true,
        skipReason: "<reason>",
      },
    ]);

    expect(html).toContain("↷");
    expect(html).toContain('title="&lt;reason&gt;"');
  });
});
