/**
 * Bun.WebView headless automation regression guard (Bun v1.3.12).
 *
 * • OS-level input: view.click() dispatches native events with isTrusted: true
 * • Selector clicks auto-wait for actionability (attached, visible, stable, unobscured)
 *
 * @see https://bun.com/blog/bun-v1.3.12#bun-webview-headless-browser-automation
 * @see https://bun.com/docs/runtime/webview
 */
import { describe, expect, test } from "bun:test";

const BUN_WEBVIEW_AUTOMATION_BLOG =
  "https://bun.com/blog/bun-v1.3.12#bun-webview-headless-browser-automation";

function dataUrlHtml(body: string): string {
  return `data:text/html,${encodeURIComponent(body)}`;
}

function webViewUnavailableReason(): string | null {
  if (typeof Bun.WebView !== "function") return "Bun.WebView unavailable";
  return null;
}

const webViewSkipReason = webViewUnavailableReason();

describe("bun-webview-automation", () => {
  describe("isTrusted clicks", () => {
    test.skipIf(webViewSkipReason !== null)(
      "view.click(selector) dispatches trusted pointer events",
      async () => {
        await using view = new Bun.WebView({ width: 480, height: 360 });
        await view.navigate(
          dataUrlHtml(`<!doctype html><html><body>
<button id="go" style="margin-top:120px">Go</button>
<script>
window.__clicks = [];
document.getElementById("go").addEventListener("click", (event) => {
  window.__clicks.push({ trusted: event.isTrusted, type: event.type });
});
</script></body></html>`)
        );
        await Bun.sleep(150);

        await view.click("#go");
        const clicks = await view.evaluate("window.__clicks");
        expect(clicks).toEqual([{ trusted: true, type: "click" }]);
      }
    );
  });

  describe("actionability waits", () => {
    test.skipIf(webViewSkipReason !== null)(
      "view.click(selector) waits until element becomes visible",
      async () => {
        const revealMs = 350;
        await using view = new Bun.WebView({ width: 480, height: 360 });
        await view.navigate(
          dataUrlHtml(`<!doctype html><html><body>
<button id="go" hidden>Go</button>
<script>
window.__clicks = 0;
document.getElementById("go").addEventListener("click", () => { window.__clicks += 1; });
setTimeout(() => { document.getElementById("go").hidden = false; }, ${revealMs});
</script></body></html>`)
        );

        const started = Bun.nanoseconds();
        await view.click("#go", { timeout: 8_000 });
        const waitedMs = (Bun.nanoseconds() - started) / 1e6;
        const clicks = await view.evaluate("window.__clicks");

        expect(clicks).toBe(1);
        expect(waitedMs).toBeGreaterThanOrEqual(revealMs * 0.6);
        expect(waitedMs).toBeLessThan(6_000);
      }
    );

    test.skipIf(webViewSkipReason !== null)(
      "view.click(selector) waits until element is unobscured",
      async () => {
        const revealMs = 400;
        await using view = new Bun.WebView({ width: 480, height: 360 });
        await view.navigate(
          dataUrlHtml(`<!doctype html><html><body style="margin:0">
<button id="go" style="position:absolute;top:100px;left:40px">Go</button>
<div id="mask" style="position:absolute;inset:0;background:rgba(0,0,0,0.01)"></div>
<script>
window.__clicks = 0;
document.getElementById("go").addEventListener("click", () => { window.__clicks += 1; });
setTimeout(() => document.getElementById("mask").remove(), ${revealMs});
</script></body></html>`)
        );

        const started = Bun.nanoseconds();
        await view.click("#go", { timeout: 8_000 });
        const waitedMs = (Bun.nanoseconds() - started) / 1e6;
        const clicks = await view.evaluate("window.__clicks");

        expect(clicks).toBe(1);
        expect(waitedMs).toBeGreaterThanOrEqual(revealMs * 0.6);
        expect(waitedMs).toBeLessThan(6_000);
      }
    );
  });

  describe("blog contract", () => {
    test("anchor documents isTrusted + actionability", () => {
      expect(BUN_WEBVIEW_AUTOMATION_BLOG).toContain("bun-v1.3.12");
      expect(BUN_WEBVIEW_AUTOMATION_BLOG).toContain("bun-webview-headless-browser-automation");
    });
  });
});
