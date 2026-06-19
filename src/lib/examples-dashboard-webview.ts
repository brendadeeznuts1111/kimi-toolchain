/**
 * examples-dashboard-webview.ts — Bun.WebView shell for examples/dashboard with optional persistence.
 *
 * @see https://bun.com/docs/runtime/webview#persistent-storage
 */

import {
  ensureExamplesDashboardCompanion,
  stopExamplesDashboardCompanion,
} from "./examples-dashboard-companion.ts";
import { buildDashboardWebViewOptions } from "./herdr-dashboard-webview-options.ts";
import { examplesDashboardWebViewStoreDir } from "./paths.ts";
import { formatWebViewExperimentalNotice, webViewSupported } from "./webview-console.ts";

export const EXAMPLES_DASHBOARD_WEBVIEW_STORE_ENV = "EXAMPLES_DASHBOARD_WEBVIEW_STORE";

export interface RunExamplesDashboardWebViewOptions {
  projectRoot: string;
  port?: number;
  /** Canvas manifest id — appended as ?canvas= */
  canvas?: string;
  persistProfile?: boolean;
  profileDir?: string;
  width?: number;
  height?: number;
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

function buildDashboardUrl(base: string, canvas?: string): string {
  const normalized = base.endsWith("/") ? base : `${base}/`;
  if (!canvas?.trim()) return normalized;
  try {
    const url = new URL(normalized);
    url.searchParams.set("canvas", canvas.trim());
    return url.toString();
  } catch {
    return normalized;
  }
}

function resolveProfileDir(options: RunExamplesDashboardWebViewOptions): string | undefined {
  const fromEnv = (Bun.env[EXAMPLES_DASHBOARD_WEBVIEW_STORE_ENV] ?? "").trim();
  if (options.profileDir?.trim()) return options.profileDir.trim();
  if (fromEnv) return fromEnv;
  if (options.persistProfile) return examplesDashboardWebViewStoreDir();
  return undefined;
}

function formatDataStoreNote(mode: "ephemeral" | "persistent", directory?: string): string {
  return mode === "persistent" && directory
    ? `dataStore persistent (${directory})`
    : "dataStore ephemeral (cookies/localStorage discarded on exit)";
}

/** Start examples dashboard (if needed), open Bun.WebView, block until ctrl+c. */
export async function runExamplesDashboardWebView(
  options: RunExamplesDashboardWebViewOptions
): Promise<void> {
  if (!webViewSupported()) {
    throw new Error("Bun.WebView is not available in this runtime");
  }

  const { resolveDashboardStartupPort } = await import("./dashboard-settings.ts");
  const { port: resolvedPort } = await resolveDashboardStartupPort(options.projectRoot);
  const port = options.port ?? (Number(Bun.env.PORT) || resolvedPort);
  const baseUrl = `http://127.0.0.1:${port}/`;
  const profileDir = resolveProfileDir(options);
  const persistProfile = options.persistProfile === true || Boolean(profileDir);

  const companion = await ensureExamplesDashboardCompanion(options.projectRoot, {
    url: baseUrl,
    autoStart: true,
  });
  if (!companion.started) {
    const health = await fetch(new URL("/health", baseUrl).toString()).catch(() => null);
    if (!health?.ok) {
      throw new Error(`examples dashboard not reachable at ${baseUrl}`);
    }
  }

  const url = buildDashboardUrl(companion.url, options.canvas);
  const { constructorOptions, store } = buildDashboardWebViewOptions(url, {
    persistProfile,
    profileDir,
    width: options.width ?? 1400,
    height: options.height ?? 900,
    warn: (message) => process.stderr.write(`[dashboard] warn: ${message}\n`),
  });

  const shutdown = bindShutdownSignal();

  try {
    process.stderr.write(`${formatWebViewExperimentalNotice()}\n`);
    process.stdout.write(
      `[dashboard] WebView open ${url} — ${formatDataStoreNote(store.mode, store.directory)} (ctrl+c to stop)\n`
    );

    await using view = new Bun.WebView(constructorOptions);
    await waitForShutdown(shutdown.signal);
    void view;
  } finally {
    stopExamplesDashboardCompanion();
  }
}

async function waitForShutdown(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    await Bun.sleep(60_000);
  }
}
