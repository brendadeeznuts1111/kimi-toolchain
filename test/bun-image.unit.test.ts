import { describe, expect, test } from "bun:test";
import {
  bunImageSupported,
  dashboardWebpThumbnail,
  DASHBOARD_THUMB_HEIGHT,
  DASHBOARD_THUMB_WIDTH,
} from "../src/lib/bun-image.ts";
import { webViewScreenshotBytes } from "../src/lib/herdr-dashboard-automation.ts";
import { webViewSupported } from "../src/lib/webview-console.ts";

describe("bun-image", () => {
  test("DASHBOARD_THUMB dimensions are 16:9 friendly", () => {
    expect(DASHBOARD_THUMB_WIDTH / DASHBOARD_THUMB_HEIGHT).toBeCloseTo(16 / 9, 1);
  });

  test("dashboardWebpThumbnail shrinks a WebView PNG capture", async () => {
    if (!webViewSupported() || !bunImageSupported()) return;

    await using view = new Bun.WebView({ width: 640, height: 360 });
    await view.navigate("data:text/html,<h1 style='color:white;background:#111'>thumb</h1>");
    await Bun.sleep(200);

    const png = await webViewScreenshotBytes(view);
    const thumb = await dashboardWebpThumbnail(png);
    expect(thumb).not.toBeNull();
    expect(thumb!.byteLength).toBeGreaterThan(100);
    expect(thumb!.byteLength).toBeLessThan(png.byteLength);
  }, 15_000);
});
