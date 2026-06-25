import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { join } from "path";
import { bunImageSupported } from "../src/lib/bun-image.ts";
import { probeDashboardThumbnail } from "../src/lib/herdr-dashboard/automation/automation-gate.ts";
import {
  AGENT_ATTACH_SELECTOR,
  AGENTS_BODY_SELECTOR,
  DASHBOARD_READY_EVAL,
  DASHBOARD_SCROLL_SETTLE_MS,
  DASHBOARD_SCREENSHOT_SCROLL_EVERY_N,
  feedDashboardScreenshotPng,
  pollUntil,
  PROCESSES_TOGGLE_SELECTOR,
  runDashboardAutomation,
  runDashboardAutomationSmoke,
  runHerdrDashboardAutomation,
  scrollToDashboardAgentsBody,
  waitForDashboardReady,
  waitForDashboardView,
  waitForSelectorCount,
  webViewScreenshotBytes,
} from "../src/lib/herdr-dashboard/automation/automation.ts";
import { MOCK_CLOCK_EPOCH } from "./helpers/mock-clock.ts";
import { startHerdrDashboardServer } from "../src/lib/herdr-dashboard/server/server.ts";
import { addChromeCdpListener, webViewSupported } from "../src/lib/webview-console.ts";
import { REPO_ROOT, withTempDir } from "./helpers.ts";

describe("herdr-dashboard-automation", () => {
  afterEach(() => {
    setSystemTime();
  });

  test("pollUntil expires deterministically with setSystemTime", async () => {
    setSystemTime(MOCK_CLOCK_EPOCH);
    let ticks = 0;
    const ok = await pollUntil(
      async () => {
        ticks += 1;
        return false;
      },
      {
        timeoutMs: 1000,
        pollMs: 200,
        sleep: async (ms) => {
          setSystemTime(new Date(Date.now() + ms));
        },
      }
    );
    expect(ok).toBe(false);
    expect(ticks).toBeGreaterThan(0);
    expect(Date.now()).toBeGreaterThanOrEqual(MOCK_CLOCK_EPOCH.getTime() + 1000);
  });

  test("waitForDashboardReady respects injected deadline clock", async () => {
    setSystemTime(MOCK_CLOCK_EPOCH);
    let evalCalls = 0;
    const evaluate = mock(async () => {
      evalCalls += 1;
      return evalCalls >= 2;
    });
    const view = { evaluate } as unknown as Bun.WebView;
    const ready = await waitForDashboardReady(view, {
      timeoutMs: 500,
      pollMs: 100,
      sleep: async (ms) => {
        setSystemTime(new Date(Date.now() + ms));
      },
    });
    expect(ready).toBe(true);
    expect(evalCalls).toBe(2);
  });
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

  test("feedDashboardScreenshotPng scrolls agents body before each screenshot capture", async () => {
    expect(DASHBOARD_SCREENSHOT_SCROLL_EVERY_N).toBe(1);

    const callOrder: string[] = [];
    const scrollTo = mock(async () => {
      callOrder.push("scrollTo");
    });
    const screenshot = mock(async () => {
      callOrder.push("screenshot");
      return new Uint8Array(128);
    });
    const evaluate = mock(async () => true);
    const view = { scrollTo, screenshot, evaluate } as unknown as Bun.WebView;
    const setScreenshotPng = mock();

    const controller = new AbortController();
    const feed = feedDashboardScreenshotPng(
      view,
      { setScreenshotPng },
      {
        signal: controller.signal,
        pollMs: 1,
        readyTimeoutMs: 100,
      }
    );

    await Bun.sleep(DASHBOARD_SCROLL_SETTLE_MS + 50);
    controller.abort();
    await feed;

    expect(screenshot).toHaveBeenCalled();
    const screenshotIdx = callOrder.indexOf("screenshot");
    expect(screenshotIdx).toBeGreaterThan(0);
    expect(callOrder[screenshotIdx - 1]).toBe("scrollTo");
    expect(setScreenshotPng).toHaveBeenCalled();
  });

  test("feedDashboardScreenshotPng populates /api/thumbnail cache", async () => {
    if (!webViewSupported()) return;
    if (!bunImageSupported()) return;

    const server = startHerdrDashboardServer({
      projectPath: REPO_ROOT,
      port: 0,
      sessions: false,
    });
    const controller = new AbortController();
    try {
      await using view = new Bun.WebView({ width: 960, height: 720, url: server.url });
      const feed = feedDashboardScreenshotPng(view, server, {
        signal: controller.signal,
        pollMs: 300,
      });

      const probe = await probeDashboardThumbnail(server.url, { timeoutMs: 12_000 });

      controller.abort();
      await feed;
      expect(probe.ok).toBe(true);
      expect(probe.contentType).toBe("image/webp");
    } finally {
      controller.abort();
      server.stop();
    }
  }, 15_000);

  test("waitForSelectorCount resolves when minCount met", async () => {
    let calls = 0;
    const evaluate = mock(async () => {
      calls += 1;
      return calls >= 2 ? 1 : 0;
    });
    const view = { evaluate } as unknown as Bun.WebView;
    const count = await waitForSelectorCount(view, "#processes-body tr", {
      minCount: 1,
      pollMs: 1,
      timeoutMs: 500,
    });
    expect(count).toBe(1);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test("runDashboardAutomation dispatches click waitForSelector screenshot in order", async () => {
    const callOrder: string[] = [];
    const scrollTo = mock(async () => {
      callOrder.push("scrollTo");
    });
    const click = mock(async () => {
      callOrder.push("click");
    });
    let evalCalls = 0;
    const evaluate = mock(async () => {
      evalCalls += 1;
      if (evalCalls === 1) return 1;
      return 0;
    });
    const screenshot = mock(async () => {
      callOrder.push("screenshot");
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...Array.from({ length: 100 }, () => 0)]);
    });
    const view = { scrollTo, click, evaluate, screenshot } as unknown as Bun.WebView;
    const setScreenshotPng = mock();

    const result = await runDashboardAutomation({
      view,
      server: { setScreenshotPng },
      waitReady: false,
      actions: [
        { type: "click", selector: PROCESSES_TOGGLE_SELECTOR },
        { type: "waitForSelector", selector: "#processes-body tr", minCount: 1, timeoutMs: 500 },
        { type: "screenshot", feed: true },
      ],
    });

    expect(callOrder).toEqual(["scrollTo", "click", "screenshot"]);
    expect(result.screenshots).toHaveLength(1);
    expect(result.evaluations).toEqual([1]);
    expect(setScreenshotPng).toHaveBeenCalledTimes(1);
  });

  test("runDashboardAutomationSmoke feeds /api/thumbnail on serve shell", async () => {
    if (!webViewSupported()) return;
    if (!bunImageSupported()) return;

    const server = startHerdrDashboardServer({
      projectPath: REPO_ROOT,
      port: 0,
      sessions: false,
      dryRun: true,
      webview: { shell: "serve" },
    });
    try {
      await using view = new Bun.WebView({ width: 1280, height: 800, url: server.url });
      const result = await runDashboardAutomationSmoke({ server, view });
      expect(result.pngBytes).toBeGreaterThan(1_000);
      expect(result.bodyRowCount).toBeGreaterThan(0);

      const res = (await fetch(
        `${server.url}api/thumbnail?width=160&height=90&quality=75`
      )) as unknown as {
        status: number;
        headers: { get(name: string): string | null };
      };
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("x-thumbnail-cache")).toMatch(/hit|miss/);
    } finally {
      server.stop();
    }
  }, 20_000);

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

    await withTempDir("herdr-dashboard-attach", async (dir) => {
      const outputPath = join(dir, "probe.png");
      const result = await runHerdrDashboardAutomation({
        projectPath: REPO_ROOT,
        sessions: false,
        dryRun: true,
        clickAttach: true,
        outputPath,
      });

      expect(result.ok).toBe(true);
      expect(result.screenshotBytes).toBeGreaterThan(0);
      if (result.agentRows > 0) {
        expect(result.clickAttachOk).toBe(true);
        expect(result.ipcCommands.some((cmd) => cmd.command === "agent.attach")).toBe(true);
      } else {
        expect(result.clickAttachOk).toBeUndefined();
      }
    });
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
