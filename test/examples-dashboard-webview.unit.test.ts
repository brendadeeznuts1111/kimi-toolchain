import { describe, expect, test } from "bun:test";
import { EXAMPLES_DASHBOARD_WEBVIEW_STORE_NAME } from "../src/lib/paths.ts";
import { EXAMPLES_DASHBOARD_WEBVIEW_STORE_ENV } from "../src/lib/examples-dashboard-webview.ts";
import { webViewSupported } from "../src/lib/webview-console.ts";

describe("examples-dashboard-webview", () => {
  test("store env constant matches paths store name", () => {
    expect(EXAMPLES_DASHBOARD_WEBVIEW_STORE_ENV).toBe("EXAMPLES_DASHBOARD_WEBVIEW_STORE");
    expect(EXAMPLES_DASHBOARD_WEBVIEW_STORE_NAME).toBe("examples-dashboard-webview");
  });

  test("webViewSupported reflects Bun.WebView availability", () => {
    expect(webViewSupported()).toBe(typeof Bun.WebView === "function");
  });
});
