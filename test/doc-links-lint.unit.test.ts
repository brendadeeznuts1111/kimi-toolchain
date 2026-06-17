import { describe, expect, test } from "bun:test";
import { scanDocLinkFile } from "../src/lib/doc-links-lint.ts";

describe("doc-links-lint", () => {
  test("allows bun.sh/docs root in canonical-references.ts", () => {
    const violations = scanDocLinkFile(
      "src/lib/canonical-references.ts",
      '    docs: "https://bun.sh/docs",\n'
    );
    expect(violations).toHaveLength(0);
  });

  test("flags bun.sh/docs deep links outside allowlist", () => {
    const violations = scanDocLinkFile(
      "src/lib/example.ts",
      " * @see https://bun.sh/docs/runtime/webview\n"
    );
    expect(violations.some((v) => v.rule === "prefer-bun-com-docs")).toBe(true);
  });

  test("allows constant definition in defining module", () => {
    const violations = scanDocLinkFile(
      "src/lib/webview-console.ts",
      'export const BUN_WEBVIEW_DOCS_URL = "https://bun.com/docs/runtime/webview";\n'
    );
    expect(violations).toHaveLength(0);
  });

  test("flags raw webview URL in consumer modules", () => {
    const violations = scanDocLinkFile(
      "src/bin/herdr-orchestrator.ts",
      '  writeOut("see https://bun.com/docs/runtime/webview");\n'
    );
    expect(violations.some((v) => v.rule === "use-doc-constant")).toBe(true);
  });

  test("allows consumer lines that reference the shared constant", () => {
    const violations = scanDocLinkFile(
      "src/lib/herdr-webview-dashboard.ts",
      "  process.stderr.write(`${formatWebViewExperimentalNotice()}\\n`);\n"
    );
    expect(violations.filter((v) => v.rule === "use-doc-constant")).toHaveLength(0);
  });
});
