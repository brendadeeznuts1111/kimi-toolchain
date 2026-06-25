import { describe, expect, test } from "bun:test";
import { bunImageSupported } from "../src/lib/bun-image.ts";
import {
  dashboardAutomationChecksFromResult,
  probeDashboardThumbnail,
  resolveDashboardAutomationUrl,
  runDashboardAutomationGate,
} from "../src/lib/herdr-dashboard/automation/automation-gate.ts";
import { webViewSupported } from "../src/lib/webview-console.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("herdr-dashboard-automation-gate", () => {
  test("resolveDashboardAutomationUrl normalizes trailing slash", () => {
    expect(resolveDashboardAutomationUrl({ url: "http://127.0.0.1:18412" })).toBe(
      "http://127.0.0.1:18412/"
    );
    expect(resolveDashboardAutomationUrl({ url: "http://127.0.0.1:18412/" })).toBe(
      "http://127.0.0.1:18412/"
    );
    expect(resolveDashboardAutomationUrl({})).toBeUndefined();
  });

  test("dashboardAutomationChecksFromResult maps ok and failure", () => {
    const okChecks = dashboardAutomationChecksFromResult({
      ok: true,
      url: "http://127.0.0.1:1/",
      ownedServer: true,
      smoke: { pngBytes: 2048, bodyRowCount: 2, processRowCount: 1 },
      thumbnail: { ok: true, status: 200, contentType: "image/webp", cache: "miss" },
    });
    expect(okChecks[0]?.status).toBe("ok");
    expect(okChecks[0]?.message).toContain("2048B");

    const failChecks = dashboardAutomationChecksFromResult({
      ok: false,
      url: "http://127.0.0.1:18412/",
      ownedServer: false,
      failure: {
        code: "thumbnail_unavailable",
        message: "thumbnail missing",
        detail: "use self-contained mode",
      },
    });
    expect(failChecks[0]?.status).toBe("error");
    expect(failChecks[0]?.message).toContain("use self-contained mode");
  });

  test("runDashboardAutomationGate self-contained smoke + thumbnail", async () => {
    if (!webViewSupported()) return;
    if (!bunImageSupported()) return;

    const result = await runDashboardAutomationGate({ projectPath: REPO_ROOT });
    expect(result.ownedServer).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.smoke?.pngBytes).toBeGreaterThan(1_000);
    expect(result.smoke?.bodyRowCount).toBeGreaterThan(0);
    expect(result.thumbnail?.contentType).toBe("image/webp");
  }, 25_000);

  test("probeDashboardThumbnail returns miss/hit webp from owned gate server", async () => {
    if (!webViewSupported()) return;
    if (!bunImageSupported()) return;

    const gate = await runDashboardAutomationGate({ projectPath: REPO_ROOT });
    expect(gate.ok).toBe(true);
    const probe = await probeDashboardThumbnail(gate.url, { timeoutMs: 3_000 });
    expect(probe.ok).toBe(true);
    expect(probe.contentType).toBe("image/webp");
  }, 30_000);
});
