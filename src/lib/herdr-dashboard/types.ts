/**
 * Shared Herdr dashboard server types — consumed by server bootstrap and automation.
 */

import type { DashboardFetchOptions, DashboardIpcResult } from "./data/data.ts";
import type { HerdrDashboardDiscoveryCache } from "./discovery/cache.ts";
import type { DashboardGateHealthWatchHandle } from "./gates/gate-watch.ts";
import type { DashboardMetaWatchHandle } from "./watch.ts";
import type { DashboardMetaWebViewInput } from "./webview/store.ts";
import type { GitWidgetDeps } from "./widgets/git.ts";
import type { LogsWidgetDeps } from "./widgets/logs.ts";
import type { ProcessesActionDeps } from "./widgets/processes-action.ts";
import type { ProcessesWidgetDeps } from "./widgets/processes.ts";
import type { DashboardHerdrEventBridgeHandle } from "./server/events.ts";
import type { HerdrDashboardHub } from "./server/hub.ts";
import type { DashboardServeTransport } from "./server/http3.ts";

export interface HerdrDashboardServerOptions extends DashboardFetchOptions {
  projectPath: string;
  port?: number;
  hostname?: string;
  dryRun?: boolean;
  /** Browser handoffs/rules poll interval (ms). */
  pollHintMs?: number;
  /** Server SSE agent-discovery poll interval (ms). */
  ssePollMs?: number;
  staleMs?: number;
  /** Start dashboard discovery polling immediately (default true unless sessions are disabled). */
  autoRefresh?: boolean;
  /** Enable HTTP/3 when TLS certs are configured (see HERDR_DASHBOARD_TLS_* env). */
  http3?: boolean;
  /** Override HERDR_DASHBOARD_TLS_CERT for tests or custom deployments. */
  tlsCertPath?: string;
  /** Override HERDR_DASHBOARD_TLS_KEY for tests or custom deployments. */
  tlsKeyPath?: string;
  onIpc?: (result: DashboardIpcResult) => void;
  /** Optional PNG supplier for `/api/thumbnail` when no cached screenshot is set. */
  screenshotProvider?: () => Promise<Uint8Array | null>;
  /** Bridge Herdr socket events → dashboard refresh (default true). */
  herdrEvents?: boolean;
  /** When false, defer Herdr event socket connect (forwarded to event bridge). */
  connect?: boolean;
  /** Inject discovery cache (tests) — skips default hub cache construction. */
  discoveryCache?: HerdrDashboardDiscoveryCache;
  /** Event-driven meta gate watch on discovery:refreshed (default true). */
  metaWatch?: boolean;
  /** Background effect-gates probe + gate:failed/gate:cleared bus (default true). */
  gateHealthWatch?: boolean;
  /** Bun.WebView shell + persistent profile (surfaced on GET /api/meta). */
  webview?: DashboardMetaWebViewInput;
  /** Inject processes widget fetch (tests). */
  widgetProcessesDeps?: Partial<ProcessesWidgetDeps>;
  /** Inject logs widget fetch (tests). */
  widgetLogsDeps?: Partial<LogsWidgetDeps>;
  /** Inject git widget fetch (tests). */
  widgetGitDeps?: Partial<GitWidgetDeps>;
  /** Inject processes pane actions (tests). */
  widgetProcessesActionDeps?: Partial<ProcessesActionDeps>;
  /** Examples tab iframe base URL (env/config resolved before server start). */
  examplesDashboardUrl?: string;
  /** Spawn examples dashboard companion when health is down (default true). */
  autoStartExamples?: boolean;
}

export interface HerdrDashboardServerHandle {
  port: number;
  hostname: string;
  url: string;
  transport: DashboardServeTransport;
  hub: HerdrDashboardHub;
  metaWatch: DashboardMetaWatchHandle | null;
  gateHealthWatch: DashboardGateHealthWatchHandle | null;
  herdrEventBridge: DashboardHerdrEventBridgeHandle;
  /** In-process request helper (avoids TLS verification for local HTTPS tests). */
  fetch: (input: string | Request) => Response | Promise<Response>;
  /** Cache a dashboard PNG for `/api/thumbnail` encoding. */
  setScreenshotPng: (png: Uint8Array) => void;
  stop: () => void;
}
