/**
 * herdr-dashboard-automation.ts — Bun.WebView screenshot, click, and CDP probes for the dashboard.
 *
 * @see https://bun.sh/docs/runtime/webview
 */

import { makeDir } from "./bun-io.ts";
import type { DashboardIpcCommand } from "./herdr-dashboard-data.ts";
import {
  startHerdrDashboardServer,
  type HerdrDashboardServerOptions,
} from "./herdr-dashboard-server.ts";
import { DashboardConsole } from "./herdr-webview-dashboard.ts";
import { herdrDashboardWebViewStoreDir } from "./paths.ts";
import {
  chromeWebViewBackend,
  defaultWebViewBackend,
  tapChromeCdpEvents,
  webViewSupported,
} from "./webview-console.ts";

export const DASHBOARD_TITLE_MARKER = "Herdr Orchestrator Dashboard";
export const DASHBOARD_READY_EVAL = "Boolean(window.__HERDR_DASHBOARD_READY__)";
export const AGENTS_BODY_SELECTOR = "#agents-body";
export const AGENT_ATTACH_SELECTOR = `${AGENTS_BODY_SELECTOR} tr button[data-action="attach"]`;

export interface HerdrDashboardAutomationOptions extends HerdrDashboardServerOptions {
  backend?: Bun.WebView.ConstructorOptions["backend"];
  dataStore?: Bun.WebView.ConstructorOptions["dataStore"];
  persistProfile?: boolean;
  width?: number;
  height?: number;
  readyTimeoutMs?: number;
  clickAttach?: boolean;
  outputPath?: string;
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
  agentRows: number;
  ipcCommands: DashboardIpcCommand[];
  clickAttachOk?: boolean;
}

/** Normalize Bun.WebView screenshot output to raw PNG bytes (`encoding: "buffer"`). */
export async function webViewScreenshotBytes(view: Bun.WebView): Promise<Uint8Array> {
  const shot = await view.screenshot({ format: "png", encoding: "buffer" });
  return new Uint8Array(shot);
}

/** Poll until the dashboard sets `window.__HERDR_DASHBOARD_READY__` or the agents table exists. */
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

function resolveDataStore(
  options: HerdrDashboardAutomationOptions
): Bun.WebView.ConstructorOptions["dataStore"] {
  if (options.dataStore) return options.dataStore;
  if (!options.persistProfile) return "ephemeral";
  const directory = herdrDashboardWebViewStoreDir();
  makeDir(directory, { recursive: true });
  return { directory };
}

/** Headless probe: serve dashboard, wait for SSE render, screenshot, optional attach click. */
export async function runHerdrDashboardAutomation(
  options: HerdrDashboardAutomationOptions
): Promise<HerdrDashboardAutomationResult> {
  if (!webViewSupported()) {
    throw new Error("Bun.WebView is not available in this runtime");
  }

  const ipcCommands: DashboardIpcCommand[] = [];
  const audit = new DashboardConsole();
  const server = startHerdrDashboardServer({ ...options, port: options.port ?? 0 });
  const url = server.url;
  const backend = options.backend ?? defaultWebViewBackend();
  let detachCdp: (() => void) | undefined;

  try {
    await using view = new Bun.WebView({
      width: options.width ?? 1280,
      height: options.height ?? 800,
      backend,
      dataStore: resolveDataStore(options),
      console: audit.webViewHandler((command) => ipcCommands.push(command)),
      url,
    });

    if (options.onCdp && options.cdpEvents?.length && chromeWebViewBackend(backend)) {
      detachCdp = tapChromeCdpEvents(view, options.cdpEvents, options.onCdp);
    }

    const ready = await waitForDashboardReady(view, {
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
        await view.click(AGENT_ATTACH_SELECTOR);
        clickAttachOk = ipcCommands.some((cmd) => cmd.command === "agent.attach");
      } catch {
        clickAttachOk = false;
      }
    }

    const png = await webViewScreenshotBytes(view);
    let outputPath: string | undefined;
    if (options.outputPath) {
      await Bun.write(options.outputPath, png);
      outputPath = options.outputPath;
    }

    return {
      ok: ready && title.includes(DASHBOARD_TITLE_MARKER),
      url,
      title,
      ready,
      screenshotBytes: png.byteLength,
      outputPath,
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
