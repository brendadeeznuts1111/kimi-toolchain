import { describe, expect, test } from "bun:test";
import {
  docLinkUrlMatchesSpec,
  extractDocLinkUrls,
  parseDocLinkUrl,
  scanDocLinkFile,
} from "../src/lib/doc-links-lint.ts";

describe("doc-links-lint", () => {
  test("parseDocLinkUrl decomposes URLPattern component fields", () => {
    const parts = parseDocLinkUrl(
      "https://user:pass@bun.com:443/docs/runtime/webview?q=1#console-capture"
    );
    expect(parts).toEqual({
      protocol: "https:",
      username: "user",
      password: "pass",
      hostname: "bun.com",
      port: "",
      pathname: "/docs/runtime/webview",
      search: "?q=1",
      hash: "#console-capture",
    });
  });

  test("docLinkUrlMatchesSpec matches pathnamePrefix and hash independently", () => {
    const parts = parseDocLinkUrl("http://bun.com/docs/runtime/webview#cdp")!;
    expect(
      docLinkUrlMatchesSpec(parts, {
        hostnames: ["bun.com"],
        pathnamePrefix: "/docs/runtime/webview",
      })
    ).toBe(true);
    expect(
      docLinkUrlMatchesSpec(parts, {
        hostnames: ["bun.com"],
        pathnamePrefix: "/docs/pm/cli/install",
      })
    ).toBe(false);
  });

  test("extractDocLinkUrls finds bare bun.sh/docs without protocol", () => {
    const urls = extractDocLinkUrls("see bun.sh/docs/runtime/webview for details");
    expect(urls).toHaveLength(1);
    expect(urls[0]?.parts.hostname).toBe("bun.sh");
    expect(urls[0]?.parts.pathname).toBe("/docs/runtime/webview");
  });

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

  test("allows bare bun.sh/docs prose in comments", () => {
    const violations = scanDocLinkFile(
      "src/lib/doc-links-lint.ts",
      "/** Extract absolute and bare bun.sh/docs URLs from a source line. */\n"
    );
    expect(violations.filter((v) => v.rule === "prefer-bun-com-docs")).toHaveLength(0);
  });

  test("allows constant definition in defining module", () => {
    const violations = scanDocLinkFile(
      "src/lib/webview-console.ts",
      'export const BUN_WEBVIEW_DOCS_URL = "https://bun.com/docs/runtime/webview";\n'
    );
    expect(violations).toHaveLength(0);
  });

  test("allows BUN_INSTALL_DOC_URL definition in bun-install-config.ts", () => {
    const violations = scanDocLinkFile(
      "src/lib/bun-install-config.ts",
      'export const BUN_INSTALL_DOC_URL = "https://bun.com/docs/pm/cli/install";\n'
    );
    expect(violations).toHaveLength(0);
  });

  test("flags raw install doc URL in consumer modules", () => {
    const violations = scanDocLinkFile(
      "src/lib/example.ts",
      '  console.log("see https://bun.com/docs/pm/cli/install");\n'
    );
    expect(violations.some((v) => v.rule === "use-doc-constant")).toBe(true);
  });

  test("allows BUN_IMAGE_DOCS_URL definition in bun-image.ts", () => {
    const violations = scanDocLinkFile(
      "src/lib/bun-image.ts",
      'export const BUN_IMAGE_DOCS_URL = "https://bun.com/docs/runtime/image";\n'
    );
    expect(violations).toHaveLength(0);
  });

  test("flags raw image doc URL in consumer modules", () => {
    const violations = scanDocLinkFile(
      "src/lib/herdr-dashboard-server.ts",
      '  writeOut("see https://bun.com/docs/runtime/image#terminals");\n'
    );
    expect(violations.some((v) => v.rule === "use-doc-constant")).toBe(true);
  });

  test("flags raw webview URL in consumer modules", () => {
    const violations = scanDocLinkFile(
      "src/bin/herdr-orchestrator.ts",
      '  writeOut("see https://bun.com/docs/runtime/webview");\n'
    );
    expect(violations.some((v) => v.rule === "use-doc-constant")).toBe(true);
  });

  test("flags http webview URL in consumer modules (protocol-agnostic match)", () => {
    const violations = scanDocLinkFile(
      "src/bin/herdr-orchestrator.ts",
      '  writeOut("see http://bun.com/docs/runtime/webview");\n'
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

  test("allows JSDoc @see deep links in comments (comment exemption, not defining-file allowlist)", () => {
    const violations = scanDocLinkFile(
      "src/lib/webview-console.ts",
      `/**
 * @see https://bun.com/docs/runtime/webview#console-capture
 * @see https://bun.com/docs/runtime/webview#cdp
 */
const x = 1;
// @see https://bun.com/docs/runtime/webview#persistent-storage
`
    );
    expect(violations).toHaveLength(0);
  });
});
