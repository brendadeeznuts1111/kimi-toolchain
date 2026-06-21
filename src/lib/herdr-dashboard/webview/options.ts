/**
 * Bun.WebView constructor options for the dashboard — isolated from automation imports.
 */

import {
  resolveHerdrDashboardWebViewStore,
  type HerdrDashboardWebViewStoreOptions,
  type ResolvedHerdrDashboardWebViewStore,
} from "./store.ts";
import { defaultWebViewBackend, webViewConsoleMirror } from "../../webview-console.ts";
import type { DashboardIpcCommand } from "../data/data.ts";

export const IPC_CONSOLE_TAG = "__HERDR_IPC__";

export type DashboardWebViewConsoleHandler = (type: string, ...args: unknown[]) => void;

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

  webViewHandler(onIpc?: (command: DashboardIpcCommand) => void): DashboardWebViewConsoleHandler {
    return createDashboardWebViewConsole(onIpc);
  }
}

/** Custom console handler — intercepts `__HERDR_IPC__` tagged page logs. */
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

export interface DashboardWebViewSessionOptions extends HerdrDashboardWebViewStoreOptions {
  resolvedStore?: ResolvedHerdrDashboardWebViewStore;
  console?: Bun.WebView.ConstructorOptions["console"];
  backend?: Bun.WebView.ConstructorOptions["backend"];
  width?: number;
  height?: number;
  onIpc?: (command: DashboardIpcCommand) => void;
  cdpEvents?: readonly string[];
  onCdp?: (method: string, params: unknown) => void;
}

function isConsoleObject(value: unknown): value is typeof globalThis.console {
  return value === globalThis.console;
}

function callConsoleMethod(
  consoleObject: typeof globalThis.console,
  type: string,
  args: unknown[]
): void {
  const sink = consoleObject[type as keyof typeof consoleObject];
  if (typeof sink === "function") {
    (sink as (...args: unknown[]) => void).apply(consoleObject, args);
  }
}

/** Resolve Bun.WebView `console` — mirror by default; custom handler only when onIpc is set.
 *  Always intercepts `{ command: "open-canvas" }` to open canvas files in the editor. */
export function resolveDashboardWebViewConsole(
  options: Pick<DashboardWebViewSessionOptions, "console" | "onIpc">
): (type: string, ...args: unknown[]) => void {
  const delegate =
    options.console ??
    (options.onIpc ? createDashboardWebViewConsole(options.onIpc) : webViewConsoleMirror());

  return (type, ...args) => {
    if (
      type === "log" &&
      args[0] &&
      typeof args[0] === "object" &&
      (args[0] as Record<string, unknown>).command === "open-canvas"
    ) {
      const { canvasId, path } = args[0] as { canvasId: string; path: string };
      const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
      const proc = Bun.spawn([openCmd, path], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      proc.unref();
      const label = canvasId || path;
      if (isConsoleObject(delegate)) {
        callConsoleMethod(delegate, type, [`[dashboard] opening ${label} → ${path}`]);
      } else if (typeof delegate === "function") {
        delegate(type, `[dashboard] opening ${label} → ${path}`);
      }
      void (async () => {
        let code = -1;
        try {
          code = await proc.exited;
        } catch {
          code = -1;
        }
        const msg =
          code === 0
            ? `[dashboard] opened ${label}`
            : `[dashboard] open failed (exit ${code}) for ${label}`;
        if (isConsoleObject(delegate)) {
          callConsoleMethod(delegate, code === 0 ? "log" : "warn", [msg]);
        } else if (typeof delegate === "function") {
          delegate(code === 0 ? "log" : "warn", msg);
        }
      })();
      return;
    }
    if (isConsoleObject(delegate)) {
      callConsoleMethod(delegate, type, args);
    } else if (typeof delegate === "function") {
      delegate(type, ...args);
    }
  };
}

/**
 * Build `new Bun.WebView(options)` for the orchestrator dashboard shell.
 * @see https://bun.com/docs/runtime/webview#new-bun-webview-options
 */
export function buildDashboardWebViewOptions(
  url: string,
  options: DashboardWebViewSessionOptions = {},
  warn?: (message: string) => void
): {
  backend: Bun.WebView.ConstructorOptions["backend"];
  constructorOptions: Bun.WebView.ConstructorOptions;
  store: ResolvedHerdrDashboardWebViewStore;
} {
  const backend = options.backend ?? defaultWebViewBackend();
  const store =
    options.resolvedStore ??
    resolveHerdrDashboardWebViewStore({
      dataStore: options.dataStore,
      persistProfile: options.persistProfile,
      profileDir: options.profileDir,
      backend,
      warn,
    });
  return {
    backend,
    store,
    constructorOptions: {
      width: options.width ?? 1280,
      height: options.height ?? 800,
      backend,
      dataStore: store.dataStore,
      console: resolveDashboardWebViewConsole(options),
      url,
    },
  };
}
