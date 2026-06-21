import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  frontmatterPreviewDataUrl,
  frontmatterPreviewHtml,
  parseFrontmatterText,
} from "../src/lib/frontmatter.ts";
import {
  BUN_WEBVIEW_AUTOMATION_CONTRACT,
  BUN_WEBVIEW_DOCS_URL,
  bunWebViewDocAnchor,
  chromeWebViewBackend,
  createWebViewConsoleCollector,
  spawnChromeBackend,
  webViewConsoleMirror,
  formatWebViewConsoleEvents,
  parseWebViewCliArgs,
  probeWebViewFrontmatter,
  unwrapWebViewConsoleArg,
  waitForNavigation,
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

  test("webViewConsoleMirror returns globalThis.console by reference", () => {
    expect(webViewConsoleMirror()).toBe(globalThis.console);
  });

  test("BUN_WEBVIEW_AUTOMATION_CONTRACT declares trusted input and actionability semantics", () => {
    expect(BUN_WEBVIEW_AUTOMATION_CONTRACT.input).toEqual({
      dispatch: "os-level-events",
      trusted: true,
      selectorActionability: ["attached", "visible", "stable", "unobscured"],
    });
  });

  test("BUN_WEBVIEW_AUTOMATION_CONTRACT tracks WebView methods and state properties", () => {
    expect(BUN_WEBVIEW_AUTOMATION_CONTRACT.methods).toEqual([
      "navigate",
      "evaluate",
      "screenshot",
      "click",
      "type",
      "press",
      "scroll",
      "scrollTo",
      "goBack",
      "goForward",
      "reload",
      "resize",
      "cdp",
    ]);
    expect(BUN_WEBVIEW_AUTOMATION_CONTRACT.stateProperties).toEqual(["url", "title", "loading"]);
  });

  test("BUN_WEBVIEW_AUTOMATION_CONTRACT tracks constructor backends and CDP event shape", () => {
    expect(BUN_WEBVIEW_AUTOMATION_CONTRACT.constructor.backends).toEqual(["webkit", "chrome"]);
    expect(BUN_WEBVIEW_AUTOMATION_CONTRACT.constructor.options).toEqual([
      "backend",
      "console",
      "dataStore",
      "width",
      "height",
    ]);
    expect(BUN_WEBVIEW_AUTOMATION_CONTRACT.constructor.browserProcess).toBe(
      "shared-per-bun-process"
    );
    expect(BUN_WEBVIEW_AUTOMATION_CONTRACT.cdpEvents).toEqual({
      backend: "chrome",
      eventType: "cdp-method-name",
      paramsLocation: "event.data",
    });
  });

  test("spawnChromeBackend builds object backend that chromeWebViewBackend recognizes", () => {
    const backend = spawnChromeBackend();
    expect(backend).toEqual({
      type: "chrome",
      url: false,
    });
    expect(chromeWebViewBackend(backend)).toBe(true);
  });

  test("bunWebViewDocAnchor builds bun.com deep links", () => {
    expect(bunWebViewDocAnchor()).toBe(BUN_WEBVIEW_DOCS_URL);
    expect(bunWebViewDocAnchor("console-capture")).toBe(`${BUN_WEBVIEW_DOCS_URL}#console-capture`);
    expect(bunWebViewDocAnchor("#persistent-storage")).toBe(
      `${BUN_WEBVIEW_DOCS_URL}#persistent-storage`
    );
  });

  describe("waitForNavigation()", () => {
    function makeMockView(): {
      view: Pick<Bun.WebView, "onNavigated" | "onNavigationFailed">;
      triggerNavigated: (url: string, title: string) => void;
      triggerFailed: (error: Error) => void;
    } {
      const view: Pick<Bun.WebView, "onNavigated" | "onNavigationFailed"> = {
        onNavigated: null,
        onNavigationFailed: null,
      };
      return {
        view,
        triggerNavigated: (url, title) =>
          (view.onNavigated as ((url: string, title: string) => void) | null)?.(url, title),
        triggerFailed: (error) =>
          (view.onNavigationFailed as ((error: Error) => void) | null)?.(error),
      };
    }

    test("resolves when onNavigated fires", async () => {
      const { view, triggerNavigated } = makeMockView();
      const nav = waitForNavigation(view as unknown as Bun.WebView, 2_000);
      triggerNavigated("https://example.com", "Example");
      const result = await nav;
      expect(result.url).toBe("https://example.com");
      expect(result.title).toBe("Example");
    });

    test("rejects when onNavigationFailed fires", async () => {
      const { view, triggerFailed } = makeMockView();
      const nav = waitForNavigation(view as unknown as Bun.WebView, 2_000);
      triggerFailed(new Error("net::ERR_NAME_NOT_RESOLVED"));
      await expect(nav).rejects.toThrow("net::ERR_NAME_NOT_RESOLVED");
    });

    test("rejects after timeout", async () => {
      const { view } = makeMockView();
      const nav = waitForNavigation(view as unknown as Bun.WebView, 20);
      await expect(nav).rejects.toThrow("WebView navigation timeout after 20ms");
    });

    test("clears both callbacks after onNavigated", async () => {
      const { view, triggerNavigated } = makeMockView();
      const nav = waitForNavigation(view as unknown as Bun.WebView, 2_000);
      triggerNavigated("https://a.com", "A");
      await nav;
      expect(view.onNavigated).toBeNull();
      expect(view.onNavigationFailed).toBeNull();
    });

    test("clears both callbacks after onNavigationFailed", async () => {
      const { view, triggerFailed } = makeMockView();
      const nav = waitForNavigation(view as unknown as Bun.WebView, 2_000);
      triggerFailed(new Error("fail"));
      await nav.catch(() => {});
      expect(view.onNavigated).toBeNull();
      expect(view.onNavigationFailed).toBeNull();
    });
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
