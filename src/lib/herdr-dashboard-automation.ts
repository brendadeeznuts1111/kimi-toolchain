/**
 * herdr-dashboard-automation.ts — Bun.WebView screenshot, click, and CDP probes for the dashboard.
 *
 * @see https://bun.com/docs/runtime/webview#new-bun-webview-options
 * @see https://bun.com/docs/runtime/webview#screenshots
 */

import { bunImageSupported, dashboardWebpThumbnail } from "./bun-image.ts";

import type { DashboardIpcCommand } from "./herdr-dashboard-data.ts";
import {
  startHerdrDashboardServer,
  type HerdrDashboardServerHandle,
  type HerdrDashboardServerOptions,
} from "./herdr-dashboard-server.ts";
import { buildDashboardWebViewOptions } from "./herdr-dashboard-webview-options.ts";
import {
  chromeWebViewBackend,
  formatWebViewExperimentalNotice,
  tapChromeCdpEvents,
  webViewSupported,
} from "./webview-console.ts";

export const DASHBOARD_TITLE_MARKER = "Herdr Orchestrator Dashboard";
export const DASHBOARD_READY_EVAL = "Boolean(window.__HERDR_DASHBOARD_READY__)";
export const AGENTS_BODY_SELECTOR = "#agents-body";
export const AGENT_ATTACH_SELECTOR = `${AGENTS_BODY_SELECTOR} tr button[data-action="attach"]`;
/** Settle time after scrollTo before screenshot (Bun scrollIntoView is instant). */
export const DASHBOARD_SCROLL_SETTLE_MS = 120;
/** Interval between interactive WebView screenshot refreshes for `/api/thumbnail`. */
export const DASHBOARD_SCREENSHOT_POLL_MS = 2_000;
/** Scroll agents table into view before every Nth screenshot in `feedDashboardScreenshotPng` (1 = each capture). */
export const DASHBOARD_SCREENSHOT_SCROLL_EVERY_N = 1;
export interface HerdrDashboardAutomationOptions extends HerdrDashboardServerOptions {
  backend?: Bun.WebView.ConstructorOptions["backend"];
  dataStore?: Bun.WebView.ConstructorOptions["dataStore"];
  persistProfile?: boolean;
  profileDir?: string;
  width?: number;
  height?: number;
  readyTimeoutMs?: number;
  clickAttach?: boolean;
  outputPath?: string;
  thumbnailPath?: string;
  /** CDP event names to subscribe (Chrome backend only). */
  cdpEvents?: readonly string[];
  onCdp?: (method: string, params: unknown) => void;
}

export interface HerdrDashboardAutomationResult {
  ok: boolean;
  url: string;
  title: string;
  ready: boolean;
  screenshotBytes: number;
  outputPath?: string;
  thumbnailPath?: string;
  thumbnailBytes?: number;
  agentRows: number;
  ipcCommands: DashboardIpcCommand[];
  clickAttachOk?: boolean;
}

/** Normalize Bun.WebView screenshot output to raw PNG bytes (`encoding: "buffer"`). */
export async function webViewScreenshotBytes(view: Bun.WebView): Promise<Uint8Array> {
  const shot = await view.screenshot({ format: "png", encoding: "buffer" });
  return new Uint8Array(shot);
}

/** Scroll the agents table into view; returns false when the selector never appears. */
export async function scrollToDashboardAgentsBody(
  view: Bun.WebView,
  opts?: { timeoutMs?: number; settleMs?: number }
): Promise<boolean> {
  try {
    await view.scrollTo(AGENTS_BODY_SELECTOR, {
      timeout: opts?.timeoutMs ?? 30_000,
    });
    await Bun.sleep(opts?.settleMs ?? DASHBOARD_SCROLL_SETTLE_MS);
    return true;
  } catch {
    return false;
  }
}

/** Scroll a dashboard selector into view (used before selector-based clicks). */
export async function scrollToDashboardSelector(
  view: Bun.WebView,
  selector: string,
  opts?: { timeoutMs?: number; settleMs?: number }
): Promise<boolean> {
  try {
    await view.scrollTo(selector, { timeout: opts?.timeoutMs ?? 30_000 });
    await Bun.sleep(opts?.settleMs ?? DASHBOARD_SCROLL_SETTLE_MS);
    return true;
  } catch {
    return false;
  }
}

/** Poll until `window.__HERDR_DASHBOARD_READY__` is true (fallback when scrollTo is insufficient). */
export async function waitForDashboardReady(
  view: Bun.WebView,
  opts?: { timeoutMs?: number; pollMs?: number }
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const pollMs = opts?.pollMs ?? 200;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const ready = await view.evaluate(DASHBOARD_READY_EVAL);
    if (ready === true) return true;
    await Bun.sleep(pollMs);
  }

  return false;
}

/**
 * Prefer selector-based readiness (scrollTo agents table), then fall back to ready-flag polling.
 * @see https://bun.com/docs/runtime/webview#scrollto — scrollTo waits for element existence
 */
export async function waitForDashboardView(
  view: Bun.WebView,
  opts?: { timeoutMs?: number; pollMs?: number; settleMs?: number }
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const scrolled = await scrollToDashboardAgentsBody(view, {
    timeoutMs: Math.min(timeoutMs, 5_000),
    settleMs: opts?.settleMs,
  });
  if (scrolled) {
    const ready = await view.evaluate(DASHBOARD_READY_EVAL);
    if (ready === true) return true;
  }
  return waitForDashboardReady(view, { timeoutMs, pollMs: opts?.pollMs });
}

export interface FeedDashboardScreenshotOptions {
  pollMs?: number;
  signal?: AbortSignal;
  readyTimeoutMs?: number;
}

/** Periodically capture WebView PNGs into the dashboard server cache until aborted. */
export async function feedDashboardScreenshotPng(
  view: Bun.WebView,
  server: Pick<HerdrDashboardServerHandle, "setScreenshotPng">,
  opts: FeedDashboardScreenshotOptions = {}
): Promise<void> {
  const pollMs = opts.pollMs ?? DASHBOARD_SCREENSHOT_POLL_MS;
  const signal = opts.signal;

  await waitForDashboardView(view, { timeoutMs: opts.readyTimeoutMs ?? 10_000 });

  let captureIndex = 0;
  while (!signal?.aborted) {
    try {
      if (captureIndex % DASHBOARD_SCREENSHOT_SCROLL_EVERY_N === 0) {
        try {
          await scrollToDashboardAgentsBody(view, { timeoutMs: 3_000 });
        } catch {
          // Ignore transient scroll failures (navigation, resize, etc.)
        }
      }
      const png = await webViewScreenshotBytes(view);
      if (png.byteLength > 0) {
        server.setScreenshotPng(png);
      }
    } catch {
      // Ignore transient screenshot failures (navigation, resize, etc.)
    }
    captureIndex += 1;
    if (signal?.aborted) break;
    await Bun.sleep(pollMs);
  }
}

/** Headless probe: serve dashboard, wait for SSE render, screenshot, optional attach click. */
export async function runHerdrDashboardAutomation(
  options: HerdrDashboardAutomationOptions
): Promise<HerdrDashboardAutomationResult> {
  if (!webViewSupported()) {
    throw new Error("Bun.WebView is not available in this runtime");
  }

  const ipcCommands: DashboardIpcCommand[] = [];
  const server = startHerdrDashboardServer({
    ...options,
    port: options.port ?? 0,
    onIpc: (result) => ipcCommands.push({ command: result.command }),
  });
  const url = server.url;
  const { backend, constructorOptions } = buildDashboardWebViewOptions(
    url,
    {
      backend: options.backend,
      dataStore: options.dataStore,
      persistProfile: options.persistProfile,
      profileDir: options.profileDir,
      width: options.width,
      height: options.height,
      onIpc: (command) => ipcCommands.push(command),
    },
    (message) => process.stderr.write(`[dashboard] warn: ${message}\n`)
  );
  process.stderr.write(`${formatWebViewExperimentalNotice()}\n`);
  let detachCdp: (() => void) | undefined;

  try {
    await using view = new Bun.WebView(constructorOptions);

    if (options.onCdp && options.cdpEvents?.length && chromeWebViewBackend(backend)) {
      detachCdp = tapChromeCdpEvents(view, options.cdpEvents, options.onCdp);
    }

    const ready = await waitForDashboardView(view, {
      timeoutMs: options.readyTimeoutMs ?? 10_000,
    });
    const title = String(view.title || (await view.evaluate("document.title || ''")));
    const agentRows = Number(
      await view.evaluate(
        `document.querySelectorAll(${JSON.stringify(`${AGENTS_BODY_SELECTOR} tr`)}).length`
      )
    );

    let clickAttachOk: boolean | undefined;
    if (options.clickAttach && agentRows > 0) {
      try {
        await scrollToDashboardSelector(view, AGENT_ATTACH_SELECTOR);
        await view.click(AGENT_ATTACH_SELECTOR);
        await Bun.sleep(50);
        clickAttachOk = ipcCommands.some((cmd) => cmd.command === "agent.attach");
      } catch {
        clickAttachOk = false;
      }
    }

    await scrollToDashboardAgentsBody(view);
    const png = await webViewScreenshotBytes(view);
    let outputPath: string | undefined;
    if (options.outputPath) {
      await Bun.write(options.outputPath, png);
      outputPath = options.outputPath;
    }

    let thumbnailPath: string | undefined;
    let thumbnailBytes: number | undefined;
    if (bunImageSupported()) {
      const thumb = await dashboardWebpThumbnail(png);
      if (thumb) {
        thumbnailBytes = thumb.byteLength;
        server.setScreenshotPng(png);
        if (options.thumbnailPath) {
          await Bun.write(options.thumbnailPath, thumb);
          thumbnailPath = options.thumbnailPath;
        }
      }
    }

    return {
      ok: ready && title.includes(DASHBOARD_TITLE_MARKER),
      url,
      title,
      ready,
      screenshotBytes: png.byteLength,
      outputPath,
      thumbnailPath,
      thumbnailBytes,
      agentRows,
      ipcCommands,
      clickAttachOk,
    };
  } finally {
    detachCdp?.();
    server.stop();
  }
}

/** Write a dashboard PNG screenshot and return probe metadata. */
export async function captureHerdrDashboardScreenshot(
  options: HerdrDashboardAutomationOptions & { outputPath: string }
): Promise<HerdrDashboardAutomationResult> {
  return runHerdrDashboardAutomation(options);
}
