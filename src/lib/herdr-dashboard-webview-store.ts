/**
 * Resolve Bun.WebView dataStore for the orchestrator dashboard.
 *
 * Defaults match Bun docs: ephemeral in-memory storage unless persistence is requested.
 * @see https://bun.com/docs/runtime/webview#persistent-storage
 */

import { makeDir } from "./bun-io.ts";
import {
  HERDR_DASHBOARD_WEBVIEW_STORE_LEGACY_NAME,
  HERDR_DASHBOARD_WEBVIEW_STORE_NAME,
  herdrDashboardWebViewStoreDir,
} from "./paths.ts";
import { defaultWebViewBackend, guardWebViewDataStore } from "./webview-console.ts";

export const HERDR_DASHBOARD_WEBVIEW_STORE_ENV = "HERDR_DASHBOARD_WEBVIEW_STORE";

export interface HerdrDashboardWebViewStoreOptions {
  /** Explicit Bun dataStore — wins over profile flags. */
  dataStore?: Bun.WebView.ConstructorOptions["dataStore"];
  /** CLI --persist-profile: use default (or env) profile directory. */
  persistProfile?: boolean;
  /** CLI --profile-dir: persistent directory (implies persist unless dataStore set). */
  profileDir?: string;
  backend?: Bun.WebView.ConstructorOptions["backend"];
  home?: string;
  warn?: (message: string) => void;
}

export interface ResolvedHerdrDashboardWebViewStore {
  dataStore: Bun.WebView.ConstructorOptions["dataStore"];
  /** Human-readable mode for logs/help. */
  mode: "ephemeral" | "persistent";
  directory?: string;
}

/** How the dashboard HTTP server was launched (for /api/meta). */
export type DashboardMetaWebViewShell = "serve" | "webview" | "automation";

export interface DashboardMetaWebViewInput {
  shell?: DashboardMetaWebViewShell;
  persistProfile?: boolean;
  profileDir?: string;
  backend?: Bun.WebView.ConstructorOptions["backend"];
  home?: string;
}

/** Serializable WebView profile block returned by GET /api/meta. */
export interface DashboardMetaWebView {
  shell: DashboardMetaWebViewShell;
  persistProfile: boolean;
  profileDir?: string;
  defaultProfileDir: string;
  defaultStoreName: string;
  mode: "ephemeral" | "persistent";
  directory?: string;
  backend: string;
}

function webViewBackendLabel(backend?: Bun.WebView.ConstructorOptions["backend"]): string {
  if (!backend) return defaultWebViewBackend();
  if (backend === "webkit" || backend === "chrome") return backend;
  if (typeof backend === "object" && "type" in backend && backend.type) {
    return String(backend.type);
  }
  return defaultWebViewBackend();
}

/** Resolve configured WebView dataStore for dashboard meta and control-plane display. */
export function buildDashboardMetaWebView(
  options: DashboardMetaWebViewInput = {}
): DashboardMetaWebView {
  const profileDir = options.profileDir?.trim() || undefined;
  const persistProfile = options.persistProfile === true || Boolean(profileDir);
  const store = resolveHerdrDashboardWebViewStore({
    persistProfile: options.persistProfile,
    profileDir,
    backend: options.backend,
    home: options.home,
  });
  return {
    shell: options.shell ?? "serve",
    persistProfile,
    profileDir,
    defaultProfileDir: herdrDashboardWebViewStoreDir(options.home),
    defaultStoreName: defaultHerdrDashboardWebViewStoreName(),
    mode: store.mode,
    directory: store.directory,
    backend: webViewBackendLabel(options.backend),
  };
}

function resolvePersistentDirectory(options: HerdrDashboardWebViewStoreOptions): string {
  const fromEnv = (Bun.env[HERDR_DASHBOARD_WEBVIEW_STORE_ENV] ?? "").trim();
  if (options.profileDir?.trim()) return options.profileDir.trim();
  if (fromEnv) return fromEnv;
  return herdrDashboardWebViewStoreDir(options.home);
}

/** Default persistent store folder name (under ~/.kimi-code/var/). */
export function defaultHerdrDashboardWebViewStoreName(): string {
  return HERDR_DASHBOARD_WEBVIEW_STORE_NAME;
}

/** Legacy store folder retained for migration notes in --help. */
export function legacyHerdrDashboardWebViewStoreName(): string {
  return HERDR_DASHBOARD_WEBVIEW_STORE_LEGACY_NAME;
}

/**
 * Map CLI/library options to Bun's dataStore (ephemeral or { directory }).
 * Applies WebKit + macOS 15.2 guard when persistence is requested.
 */
export function resolveHerdrDashboardWebViewStore(
  options: HerdrDashboardWebViewStoreOptions = {}
): ResolvedHerdrDashboardWebViewStore {
  if (options.dataStore !== undefined) {
    const dataStore = guardWebViewDataStore({
      dataStore: options.dataStore,
      backend: options.backend ?? defaultWebViewBackend(),
      warn: options.warn,
    });
    if (dataStore === "ephemeral") {
      return { dataStore, mode: "ephemeral" };
    }
    const directory =
      typeof dataStore === "object" && dataStore && "directory" in dataStore
        ? String(dataStore.directory)
        : undefined;
    return { dataStore, mode: "persistent", directory };
  }

  const wantsPersist = options.persistProfile === true || Boolean(options.profileDir?.trim());
  if (!wantsPersist) {
    return { dataStore: "ephemeral", mode: "ephemeral" };
  }

  const directory = resolvePersistentDirectory(options);
  makeDir(directory, { recursive: true });
  const dataStore = guardWebViewDataStore({
    dataStore: { directory },
    backend: options.backend ?? defaultWebViewBackend(),
    warn: options.warn,
  });
  if (dataStore === "ephemeral") {
    return { dataStore, mode: "ephemeral" };
  }
  return { dataStore, mode: "persistent", directory };
}
