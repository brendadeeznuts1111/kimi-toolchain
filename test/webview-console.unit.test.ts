import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  frontmatterPreviewDataUrl,
  frontmatterPreviewHtml,
  parseFrontmatterText,
} from "../src/lib/frontmatter.ts";
import {
  createWebViewConsoleCollector,
  formatWebViewConsoleEvents,
  parseWebViewCliArgs,
  probeWebViewFrontmatter,
  unwrapWebViewConsoleArg,
  webViewSupported,
} from "../src/lib/webview-console.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("webview-console", () => {
  test("unwrapWebViewConsoleArg unwraps CDP RemoteObject previews", () => {
    const value = unwrapWebViewConsoleArg({
      type: "object",
      className: "Object",
      description: "Object",
      preview: {
        properties: [
          { name: "nested", type: "object", value: { deep: 1 } },
          { name: "label", type: "string", value: "ok" },
        ],
      },
    });
    expect(value).toEqual({ nested: { deep: 1 }, label: "ok" });
  });

  test("unwrapWebViewConsoleArg preserves primitives and WebKit JSON objects", () => {
    expect(unwrapWebViewConsoleArg("hi")).toBe("hi");
    expect(unwrapWebViewConsoleArg(42)).toBe(42);
    expect(unwrapWebViewConsoleArg({ nested: { deep: 1 } })).toEqual({ nested: { deep: 1 } });
  });

  test("createWebViewConsoleCollector normalizes handler args", () => {
    const collector = createWebViewConsoleCollector();
    collector.handler("log", "one", { two: 2 });
    expect(collector.events).toHaveLength(1);
    expect(collector.events[0]?.type).toBe("log");
    expect(collector.events[0]?.args).toEqual(["one", { two: 2 }]);
    expect(collector.drain()).toHaveLength(1);
    expect(collector.events).toHaveLength(0);
  });

  test("formatWebViewConsoleEvents uses explicit inspect depth", () => {
    const lines = formatWebViewConsoleEvents(
      [{ type: "log", args: [{ a: { b: { c: "deep" } } }], timestamp: "t" }],
      10
    );
    expect(lines).toContain("deep");
    expect(lines).not.toContain("[Object");
  });

  test("parseWebViewCliArgs parses open and frontmatter modes", () => {
    expect(parseWebViewCliArgs(["https://example.com", "--json", "--depth", "4"])).toEqual({
      mode: "open",
      target: "https://example.com",
      mirror: false,
      json: true,
      depth: 4,
      script: undefined,
      waitMs: 100,
      backend: undefined,
    });
    expect(parseWebViewCliArgs(["frontmatter", "doc.md", "--mirror"])).toEqual({
      mode: "frontmatter",
      target: "doc.md",
      mirror: true,
      json: false,
      depth: 10,
      script: undefined,
      waitMs: 100,
      backend: undefined,
    });
    expect(parseWebViewCliArgs(["--nope"])).toEqual({ error: "Unknown flag: --nope" });
  });

  test("frontmatterPreviewHtml logs data via inline script", () => {
    const parsed = parseFrontmatterText(
      `---
name: demo
meta:
  nested: true
---
# Body
`,
      "demo.md"
    );
    const html = frontmatterPreviewHtml(parsed);
    expect(html).toContain("frontmatter:data");
    expect(html).toContain('"name":"demo"');
    expect(html).toContain("# Body");
    expect(frontmatterPreviewDataUrl(parsed).startsWith("data:text/html")).toBe(true);
  });

  test("probeWebViewFrontmatter captures page console on supported runtimes", async () => {
    if (!webViewSupported()) return;

    const path = join(REPO_ROOT, "skills/effect-discipline/SKILL.md");
    const { parsed, capture } = await probeWebViewFrontmatter(path, { waitMs: 150 });
    expect(parsed.data.name).toBe("effect-discipline");
    expect(capture.events.length).toBeGreaterThan(0);
    const dataEvent = capture.events.find((event) => event.args[0] === "frontmatter:data");
    expect(dataEvent?.args[1]).toMatchObject({ name: "effect-discipline" });
  });
});
