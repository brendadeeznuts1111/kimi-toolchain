/**
 * herdr-webview-dashboard.ts — WebView shell for the orchestrator dashboard with audit console.
 *
 * Bun.WebView (v1.3.12+): use `await using` for view disposal; server stops in finally.
 * Page→Bun IPC uses the `console` constructor option (not WKWebView postMessage).
 * Page→server commands use fetch to `/api/ipc`.
 *
 * @see https://bun.com/docs/runtime/webview#new-bun-webview-options
 * @see https://bun.com/docs/runtime/webview#console-capture
 */

import { writeStdoutLine } from "./cli-contract.ts";
import {
  resolveHerdrDashboardWebViewStore,
  type ResolvedHerdrDashboardWebViewStore,
} from "./herdr-dashboard-webview-store.ts";
import {
  chromeWebViewBackend,
  defaultWebViewBackend,
  formatWebViewExperimentalNotice,
  tapChromeCdpEvents,
  webViewSupported,
} from "./webview-console.ts";
import { feedDashboardScreenshotPng } from "./herdr-dashboard-automation.ts";
import {
  ensureExamplesDashboardCompanion,
  stopExamplesDashboardCompanion,
} from "./examples-dashboard-companion.ts";
import {
  startHerdrDashboardServer,
  type HerdrDashboardServerHandle,
  type HerdrDashboardServerOptions,
} from "./herdr-dashboard-server.ts";
import {
  buildDashboardWebViewOptions,
  DashboardConsole,
  createDashboardWebViewConsole,
  IPC_CONSOLE_TAG,
  resolveDashboardWebViewConsole,
  type DashboardWebViewConsoleHandler,
  type DashboardWebViewSessionOptions,
} from "./herdr-dashboard-webview-options.ts";

export {
  IPC_CONSOLE_TAG,
  DashboardConsole,
  createDashboardWebViewConsole,
  resolveDashboardWebViewConsole,
  buildDashboardWebViewOptions,
  type DashboardWebViewConsoleHandler,
  type DashboardWebViewSessionOptions,
};

/** @alias DashboardWebViewSessionOptions — server URL comes from HerdrDashboardServerHandle. */
export type OpenHerdrDashboardWebViewOptions = DashboardWebViewSessionOptions;

/** Inject fetch-based IPC bridge after navigation completes. */
export async function installDashboardIpcBridge(view: Bun.WebView): Promise<void> {
  await view.evaluate(`
    (() => {
      if (window.__herdrBridgeInstalled) return;
      window.__herdrBridgeInstalled = true;
      window.herdr = {
        postMessage: (payload) =>
          fetch("/api/ipc", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload) }).then((r) => r.json()) };
    })()
  `);
}

/**
 * Run a dashboard WebView session — `await using` disposes the view; server stops in finally.
 */
export async function runDashboardWebViewSession(
  url: string,
  server: HerdrDashboardServerHandle,
  options: DashboardWebViewSessionOptions,
  run: (view: Bun.WebView) => Promise<void>
): Promise<void> {
  const audit = new DashboardConsole();
  const { backend, constructorOptions } = buildDashboardWebViewOptions(url, options, (message) =>
    audit.warn(message)
  );
  let detachCdp: (() => void) | undefined;

  try {
    await using view = new Bun.WebView(constructorOptions);

    if (options.onCdp && options.cdpEvents?.length && chromeWebViewBackend(backend)) {
      detachCdp = tapChromeCdpEvents(view, options.cdpEvents, options.onCdp);
    }

    await installDashboardIpcBridge(view);
    await run(view);
  } finally {
    detachCdp?.();
    server.stop();
  }
}

/** @deprecated Use DashboardConsole.webViewHandler */
export function createDashboardConsoleMirror(): (type: string, ...args: unknown[]) => void {
  return new DashboardConsole().webViewHandler();
}

function bindShutdownSignal(): AbortController {
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  controller.signal.addEventListener(
    "abort",
    () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    },
    { once: true }
  );
  return controller;
}

async function waitForShutdownSignal(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    await Bun.sleep(60_000);
  }
}

async function waitForShutdown(): Promise<void> {
  const shutdown = bindShutdownSignal();
  await waitForShutdownSignal(shutdown.signal);
}

function formatDataStoreNote(store: ResolvedHerdrDashboardWebViewStore): string {
  return store.mode === "persistent" && store.directory
    ? `dataStore persistent (${store.directory})`
    : "dataStore ephemeral (default; cookies/localStorage discarded on exit)";
}

async function prepareHerdrDashboardServerOptions(
  options: HerdrDashboardServerOptions
): Promise<HerdrDashboardServerOptions> {
  const companion = await ensureExamplesDashboardCompanion(options.projectPath, {
    url: options.examplesDashboardUrl,
    autoStart: options.autoStartExamples !== false,
  });
  if (companion.started) {
    process.stderr.write(
      `[dashboard] started examples companion at ${companion.url} (PORT from URL)\n`
    );
  }
  return { ...options, examplesDashboardUrl: companion.url };
}

/** Launch dashboard server and open a Bun.WebView pane pointed at it. */
export async function runHerdrDashboardWebView(
  serverOptions: HerdrDashboardServerOptions,
  viewOptions: Partial<OpenHerdrDashboardWebViewOptions> = {}
): Promise<HerdrDashboardServerHandle> {
  if (!webViewSupported()) {
    throw new Error("Bun.WebView is not available in this runtime");
  }

  const prepared = await prepareHerdrDashboardServerOptions(serverOptions);
  const server = startHerdrDashboardServer({
    ...prepared,
    onIpc: (result) => {
      if (!result.ok) new DashboardConsole().warn("ipc", result.command, result.message);
    },
  });
  const url = server.url;

  const backend = viewOptions.backend ?? defaultWebViewBackend();
  const store = resolveHerdrDashboardWebViewStore({
    dataStore: viewOptions.dataStore,
    persistProfile: viewOptions.persistProfile,
    profileDir: viewOptions.profileDir,
    backend,
    warn: (message) => process.stderr.write(`[dashboard] warn: ${message}\n`),
  });

  try {
    await runDashboardWebViewSession(
      url,
      server,
      {
        ...viewOptions,
        resolvedStore: store,
      },
      async (view) => {
        process.stderr.write(`${formatWebViewExperimentalNotice()}\n`);
        await writeStdoutLine(
          `[dashboard] WebView open ${url} — ${formatDataStoreNote(store)} (ctrl+c to stop)`
        );
        const shutdown = bindShutdownSignal();
        await Promise.all([
          feedDashboardScreenshotPng(view, server, { signal: shutdown.signal }),
          waitForShutdownSignal(shutdown.signal),
        ]);
      }
    );
  } finally {
    server.stop();
    stopExamplesDashboardCompanion();
  }

  return server;
}

/** Serve only — blocks until SIGINT/SIGTERM. */
export async function runHerdrDashboardServe(
  options: HerdrDashboardServerOptions
): Promise<HerdrDashboardServerHandle> {
  const prepared = await prepareHerdrDashboardServerOptions(options);
  const server = startHerdrDashboardServer(prepared);
  const transportNote = server.transport.http3
    ? "HTTP/3+TLS"
    : server.transport.fallbackReason
      ? `HTTP/1.1 (HTTP/3 fallback: ${server.transport.fallbackReason})`
      : "HTTP/1.1";
  await writeStdoutLine(
    `[dashboard] serving ${server.url} (${transportNote}, SSE /api/agents/live)`
  );
  try {
    await waitForShutdown();
  } finally {
    server.stop();
    stopExamplesDashboardCompanion();
  }
  return server;
}
