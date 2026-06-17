import { describe, expect, mock, test } from "bun:test";
import { join } from "path";
import {
  AGENT_ATTACH_SELECTOR,
  AGENTS_BODY_SELECTOR,
  DASHBOARD_READY_EVAL,
  DASHBOARD_SCROLL_SETTLE_MS,
  runHerdrDashboardAutomation,
  scrollToDashboardAgentsBody,
  waitForDashboardReady,
  waitForDashboardView,
  webViewScreenshotBytes,
} from "../src/lib/herdr-dashboard-automation.ts";
import { startHerdrDashboardServer } from "../src/lib/herdr-dashboard-server.ts";
import { addChromeCdpListener, webViewSupported } from "../src/lib/webview-console.ts";
import { REPO_ROOT, withTempDir } from "./helpers.ts";

describe("herdr-dashboard-automation", () => {
  test("AGENT_ATTACH_SELECTOR targets data-action attach buttons", () => {
    expect(AGENT_ATTACH_SELECTOR).toContain('data-action="attach"');
  });

  test("webViewScreenshotBytes returns PNG magic on supported runtimes", async () => {
    if (!webViewSupported()) return;

    await using view = new Bun.WebView({ width: 400, height: 300 });
    await view.navigate("data:text/html,<h1>shot</h1>");
    await Bun.sleep(200);
    const bytes = await webViewScreenshotBytes(view);
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
  }, 10_000);

  test("waitForDashboardView resolves after SSE render", async () => {
    if (!webViewSupported()) return;

    const server = startHerdrDashboardServer({
      projectPath: REPO_ROOT,
      port: 0,
      sessions: false,
    });
    try {
      await using view = new Bun.WebView({ width: 960, height: 720, url: server.url });
      const ready = await waitForDashboardView(view, { timeoutMs: 8_000 });
      expect(ready).toBe(true);
      const flag = await view.evaluate(DASHBOARD_READY_EVAL);
      expect(flag).toBe(true);
      const scrolled = await scrollToDashboardAgentsBody(view, { timeoutMs: 3_000 });
      expect(scrolled).toBe(true);
    } finally {
      server.stop();
    }
  }, 15_000);

  test("waitForDashboardReady still polls ready flag as fallback", async () => {
    if (!webViewSupported()) return;

    await using view = new Bun.WebView({ width: 640, height: 480 });
    await view.navigate(
      "data:text/html,<script>window.__HERDR_DASHBOARD_READY__=true</script><div id='agents-body'></div>"
    );
    await Bun.sleep(DASHBOARD_SCROLL_SETTLE_MS);
    expect(await waitForDashboardReady(view, { timeoutMs: 2_000 })).toBe(true);
    expect(await scrollToDashboardAgentsBody(view, { timeoutMs: 2_000 })).toBe(true);
    expect(AGENTS_BODY_SELECTOR).toBe("#agents-body");
  }, 10_000);

  test("runHerdrDashboardAutomation captures dashboard PNG", async () => {
    if (!webViewSupported()) return;

    await withTempDir("herdr-dashboard", async (dir) => {
      const outputPath = join(dir, "dashboard.png");
      const result = await runHerdrDashboardAutomation({
        projectPath: REPO_ROOT,
        sessions: false,
        dryRun: true,
        outputPath,
      });

      expect(result.ok).toBe(true);
      expect(result.ready).toBe(true);
      expect(result.title).toContain("Herdr");
      expect(result.screenshotBytes).toBeGreaterThan(10_000);
      expect(result.outputPath).toBe(outputPath);
      const file = await Bun.file(outputPath).arrayBuffer();
      expect(file.byteLength).toBe(result.screenshotBytes);
    });
  }, 20_000);

  test("runHerdrDashboardAutomation clickAttach records IPC when agents exist", async () => {
    if (!webViewSupported()) return;

    const result = await runHerdrDashboardAutomation({
      projectPath: REPO_ROOT,
      sessions: false,
      dryRun: true,
      clickAttach: true,
    });

    expect(result.ok).toBe(true);
    if (result.agentRows > 0) {
      expect(result.clickAttachOk).toBe(true);
      expect(result.ipcCommands.some((cmd) => cmd.command === "agent.attach")).toBe(true);
    } else {
      expect(result.clickAttachOk).toBeUndefined();
    }
  }, 20_000);

  test("addChromeCdpListener registers named CDP event handlers", () => {
    const received: unknown[] = [];
    const view = {
      addEventListener: mock(),
      removeEventListener: mock(),
    } as unknown as Bun.WebView;
    const detach = addChromeCdpListener(view, "Network.responseReceived", (params) => {
      received.push(params);
    });
    const handler = (view.addEventListener as ReturnType<typeof mock>).mock.calls[0]?.[1] as (
      event: Event
    ) => void;
    handler({ data: { response: { status: 200 } } } as MessageEvent);
    expect(received).toHaveLength(1);
    detach();
    expect(view.removeEventListener).toHaveBeenCalled();
  });
});
