/**
 * herdr-webview-dashboard.ts — WebView shell for the orchestrator dashboard with audit console.
 *
 * Bun.WebView (v1.3.12+): programmatic browser via `navigate`, `evaluate`, `console` capture,
 * and `await using` disposal. Page→Bun IPC uses the `console` constructor option (not WKWebView
 * postMessage). Page→server commands use fetch to `/api/ipc`.
 *
 * @see https://bun.sh/docs/runtime/webview
 */

import { makeDir } from "./bun-io.ts";
import { herdrDashboardWebViewStoreDir } from "./paths.ts";
import {
  chromeWebViewBackend,
  defaultWebViewBackend,
  tapChromeCdpEvents,
  webViewSupported,
} from "./webview-console.ts";
import {
  startHerdrDashboardServer,
  type HerdrDashboardServerHandle,
  type HerdrDashboardServerOptions,
} from "./herdr-dashboard-server.ts";
import { runDashboardIpcCommand, type DashboardIpcCommand } from "./herdr-dashboard-data.ts";

const IPC_CONSOLE_TAG = "__HERDR_IPC__";

export interface OpenHerdrDashboardWebViewOptions {
  port: number;
  hostname?: string;
  console?: Bun.WebView.ConstructorOptions["console"];
  backend?: Bun.WebView.ConstructorOptions["backend"];
  dataStore?: Bun.WebView.ConstructorOptions["dataStore"];
  persistProfile?: boolean;
  width?: number;
  height?: number;
  onIpc?: (command: DashboardIpcCommand) => void;
  cdpEvents?: readonly string[];
  onCdp?: (method: string, params: unknown) => void;
}

function resolveDashboardDataStore(
  options: Pick<OpenHerdrDashboardWebViewOptions, "dataStore" | "persistProfile">
): Bun.WebView.ConstructorOptions["dataStore"] {
  if (options.dataStore) return options.dataStore;
  if (!options.persistProfile) return "ephemeral";
  const directory = herdrDashboardWebViewStoreDir();
  makeDir(directory, { recursive: true });
  return { directory };
}

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

  /** WebView console option — mirrors page logs with timestamps; intercepts IPC tag. */
  webViewHandler(
    onIpc?: (command: DashboardIpcCommand) => void
  ): (type: string, ...args: unknown[]) => void {
    return (type, ...args) => {
      if (args[0] === IPC_CONSOLE_TAG && args[1] && typeof args[1] === "object") {
        const command = args[1] as DashboardIpcCommand;
        onIpc?.(command);
        this.log("ipc", command.command, command.args ?? {});
        return;
      }
      this.route(type, ...args);
    };
  }
}

/** RAII WebView wrapper — disposes via `using` / `await using`. */
export class DashboardView implements Disposable, AsyncDisposable {
  readonly view: Bun.WebView;
  readonly console: DashboardConsole;
  private readonly server: HerdrDashboardServerHandle;
  private readonly detachCdp?: () => void;

  constructor(
    url: string,
    server: HerdrDashboardServerHandle,
    options: {
      console?: Bun.WebView.ConstructorOptions["console"];
      backend?: Bun.WebView.ConstructorOptions["backend"];
      dataStore?: Bun.WebView.ConstructorOptions["dataStore"];
      persistProfile?: boolean;
      width?: number;
      height?: number;
      onIpc?: (command: DashboardIpcCommand) => void;
      cdpEvents?: readonly string[];
      onCdp?: (method: string, params: unknown) => void;
    } = {}
  ) {
    this.server = server;
    this.console = new DashboardConsole();
    const backend = options.backend ?? defaultWebViewBackend();
    this.view = new Bun.WebView({
      width: options.width ?? 1280,
      height: options.height ?? 800,
      backend,
      dataStore: resolveDashboardDataStore(options),
      console: options.console ?? this.console.webViewHandler(options.onIpc),
      url,
    });

    if (options.onCdp && options.cdpEvents?.length && chromeWebViewBackend(backend)) {
      this.detachCdp = tapChromeCdpEvents(this.view, options.cdpEvents, options.onCdp);
    }
  }

  /** Inject fetch-based IPC bridge after constructor `url` navigation completes. */
  async open(): Promise<void> {
    await this.view.evaluate(`
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

  [Symbol.dispose](): void {
    this.detachCdp?.();
    this.view.close();
    this.server.stop();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.detachCdp?.();
    this.view.close();
    this.server.stop();
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

function ipcBridgeHandler(projectPath: string, onIpc?: (command: DashboardIpcCommand) => void) {
  return (command: DashboardIpcCommand) => {
    onIpc?.(command);
    runDashboardIpcCommand(projectPath, command);
  };
}

/** Launch dashboard server and open a Bun.WebView pane pointed at it. */
export async function runHerdrDashboardWebView(
  serverOptions: HerdrDashboardServerOptions,
  viewOptions: Partial<OpenHerdrDashboardWebViewOptions> = {}
): Promise<HerdrDashboardServerHandle> {
  if (!webViewSupported()) {
    throw new Error("Bun.WebView is not available in this runtime");
  }

  const onIpc = ipcBridgeHandler(serverOptions.projectPath, viewOptions.onIpc);
  const server = startHerdrDashboardServer({
    ...serverOptions,
    onIpc: (result) => {
      if (!result.ok) new DashboardConsole().warn("ipc", result.command, result.message);
    },
  });
  const url = server.url;

  await (async () => {
    await using dashboard = new DashboardView(url, server, {
      ...viewOptions,
      onIpc,
    });
    await dashboard.open();
    process.stdout.write(`[dashboard] WebView open ${url} (ctrl+c to stop)\n`);
    await waitForShutdown();
  })();

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
  await waitForShutdown();
  server.stop();
  return server;
}
