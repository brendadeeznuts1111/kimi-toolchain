/**
 * herdr-webview-dashboard.ts — WebView shell for the orchestrator dashboard with audit console.
 *
 * Bun.WebView (v1.3.12+): use `await using` for view disposal; server stops in finally.
 * Page→Bun IPC uses the `console` constructor option (not WKWebView postMessage).
 * Page→server commands use fetch to `/api/ipc`.
 *
 * @see https://bun.com/docs/runtime/webview#console-capture
 */

import {
  resolveHerdrDashboardWebViewStore,
  type HerdrDashboardWebViewStoreOptions,
  type ResolvedHerdrDashboardWebViewStore,
} from "./herdr-dashboard-webview-store.ts";
import {
  chromeWebViewBackend,
  defaultWebViewBackend,
  formatWebViewExperimentalNotice,
  tapChromeCdpEvents,
  webViewConsoleMirror,
  webViewSupported,
} from "./webview-console.ts";
import {
  startHerdrDashboardServer,
  type HerdrDashboardServerHandle,
  type HerdrDashboardServerOptions,
} from "./herdr-dashboard-server.ts";
import type { DashboardIpcCommand } from "./herdr-dashboard-data.ts";

export const IPC_CONSOLE_TAG = "__HERDR_IPC__";

export type DashboardWebViewConsoleHandler = (type: string, ...args: unknown[]) => void;

/**
 * Custom console handler — intercepts `__HERDR_IPC__` tagged page logs.
 * Prefer `webViewConsoleMirror()` (globalThis.console by reference) for dashboard shells;
 * page IPC commands are served via POST /api/ipc after `installDashboardIpcBridge`.
 * @see https://bun.com/docs/runtime/webview#console-capture
 */
export function createDashboardWebViewConsole(
  onIpc?: (command: DashboardIpcCommand) => void
): DashboardWebViewConsoleHandler {
  const audit = new DashboardConsole();
  return (type, ...args) => {
    if (args[0] === IPC_CONSOLE_TAG && args[1] && typeof args[1] === "object") {
      const command = args[1] as DashboardIpcCommand;
      onIpc?.(command);
      audit.log("ipc", command.command, command.args ?? {});
      return;
    }
    const sink =
      type === "error"
        ? globalThis.console.error
        : type === "warn"
          ? globalThis.console.warn
          : type === "info"
            ? globalThis.console.info
            : type === "debug"
              ? globalThis.console.debug
              : globalThis.console.log;
    sink.apply(globalThis.console, args);
  };
}

/** Resolve Bun.WebView `console` — mirror by default; custom handler only when onIpc is set. */
export function resolveDashboardWebViewConsole(
  options: Pick<DashboardWebViewSessionOptions, "console" | "onIpc">
): Bun.WebView.ConstructorOptions["console"] {
  if (options.console !== undefined) return options.console;
  if (options.onIpc) return createDashboardWebViewConsole(options.onIpc);
  return webViewConsoleMirror();
}

export interface DashboardWebViewSessionOptions extends HerdrDashboardWebViewStoreOptions {
  /** Pre-resolved store — skips a second resolve + warn pass when the caller already resolved. */
  resolvedStore?: ResolvedHerdrDashboardWebViewStore;
  console?: Bun.WebView.ConstructorOptions["console"];
  backend?: Bun.WebView.ConstructorOptions["backend"];
  width?: number;
  height?: number;
  onIpc?: (command: DashboardIpcCommand) => void;
  cdpEvents?: readonly string[];
  onCdp?: (method: string, params: unknown) => void;
}

/** @alias DashboardWebViewSessionOptions — server URL comes from HerdrDashboardServerHandle. */
export type OpenHerdrDashboardWebViewOptions = DashboardWebViewSessionOptions;

function writeAuditLine(stream: 1 | 2, type: string, prefix: string, args: unknown[]): void {
  const line = [prefix, type, ...args.map((arg) => Bun.inspect(arg, { colors: false }))].join(" ");
  const target = stream === 2 ? Bun.stderr : Bun.stdout;
  target.write(`${line}\n`);
}

/** Timestamped audit console (HH:MM:SS prefix) routing to Bun stdout/stderr. */
export class DashboardConsole {
  private prefix(): string {
    return `[${new Date().toISOString().slice(11, 19)}]`;
  }

  log(...args: unknown[]): void {
    writeAuditLine(1, "log", this.prefix(), args);
  }

  error(...args: unknown[]): void {
    writeAuditLine(2, "error", this.prefix(), args);
  }

  warn(...args: unknown[]): void {
    writeAuditLine(2, "warn", this.prefix(), args);
  }

  route(type: string, ...args: unknown[]): void {
    const stream = type === "error" || type === "warn" ? 2 : 1;
    writeAuditLine(stream, type, this.prefix(), args);
  }

  /**
   * Timestamped custom console handler (legacy).
   * Prefer createDashboardWebViewConsole() for Bun-native mirror + IPC interception.
   */
  webViewHandler(onIpc?: (command: DashboardIpcCommand) => void): DashboardWebViewConsoleHandler {
    return createDashboardWebViewConsole(onIpc);
  }
}

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
            body: JSON.stringify(payload),
          }).then((r) => r.json()),
      };
    })()
  `);
}

/** Build Bun.WebView constructor options for the orchestrator dashboard shell. */
export function buildDashboardWebViewOptions(
  url: string,
  options: DashboardWebViewSessionOptions = {}
): {
  backend: Bun.WebView.ConstructorOptions["backend"];
  constructorOptions: Bun.WebView.ConstructorOptions;
  store: ResolvedHerdrDashboardWebViewStore;
} {
  const audit = new DashboardConsole();
  const backend = options.backend ?? defaultWebViewBackend();
  const store =
    options.resolvedStore ??
    resolveHerdrDashboardWebViewStore({
      dataStore: options.dataStore,
      persistProfile: options.persistProfile,
      profileDir: options.profileDir,
      backend,
      warn: (message) => audit.warn(message),
    });
  return {
    backend,
    store,
    constructorOptions: {
      width: options.width ?? 1280,
      height: options.height ?? 800,
      backend,
      dataStore: store.dataStore,
      // Mirror page console.* to Bun stdout/stderr with native formatting (zero overhead)
      console: resolveDashboardWebViewConsole(options),
      url,
    },
  };
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
  const { backend, constructorOptions } = buildDashboardWebViewOptions(url, options);
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

async function waitForShutdown(): Promise<void> {
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    while (!controller.signal.aborted) {
      await Bun.sleep(60_000);
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

function formatDataStoreNote(store: ResolvedHerdrDashboardWebViewStore): string {
  return store.mode === "persistent" && store.directory
    ? `dataStore persistent (${store.directory})`
    : "dataStore ephemeral (default; cookies/localStorage discarded on exit)";
}

/** Launch dashboard server and open a Bun.WebView pane pointed at it. */
export async function runHerdrDashboardWebView(
  serverOptions: HerdrDashboardServerOptions,
  viewOptions: Partial<OpenHerdrDashboardWebViewOptions> = {}
): Promise<HerdrDashboardServerHandle> {
  if (!webViewSupported()) {
    throw new Error("Bun.WebView is not available in this runtime");
  }

  const server = startHerdrDashboardServer({
    ...serverOptions,
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

  await runDashboardWebViewSession(
    url,
    server,
    {
      ...viewOptions,
      resolvedStore: store,
    },
    async () => {
      process.stderr.write(`${formatWebViewExperimentalNotice()}\n`);
      process.stdout.write(
        `[dashboard] WebView open ${url} — ${formatDataStoreNote(store)} (ctrl+c to stop)\n`
      );
      await waitForShutdown();
    }
  );

  return server;
}

/** Serve only — blocks until SIGINT/SIGTERM. */
export async function runHerdrDashboardServe(
  options: HerdrDashboardServerOptions
): Promise<HerdrDashboardServerHandle> {
  const server = startHerdrDashboardServer(options);
  const transportNote = server.transport.http3
    ? "HTTP/3+TLS"
    : server.transport.fallbackReason
      ? `HTTP/1.1 (HTTP/3 fallback: ${server.transport.fallbackReason})`
      : "HTTP/1.1";
  process.stdout.write(
    `[dashboard] serving ${server.url} (${transportNote}, SSE /api/agents/live)\n`
  );
  try {
    await waitForShutdown();
  } finally {
    server.stop();
  }
  return server;
}
