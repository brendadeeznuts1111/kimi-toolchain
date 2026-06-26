/**
 * herdr-dashboard/automation/automation-gate.ts — WebView smoke + /api/thumbnail probe for kimi-doctor --automation.
 *
 * Indirect terminal: smoke `setScreenshotPng` then `fetch` `/api/thumbnail` (encode in server on GET).
 *
 * @see {@link BUN_IMAGE_TERMINALS_URL}
 * @see docs/references/dashboard-thumbnails.md — Terminals + call-site map
 */

import { bunImageSupported } from "../../bun-image.ts";
import {
  dashboardSmokeActions,
  pollUntil,
  runDashboardAutomation,
  runDashboardAutomationSmoke,
  type DashboardAutomationSmokeResult,
} from "./automation.ts";
import { normalizeDashboardBaseUrl, resolveDashboardMetaUrl } from "../gates/meta-gate.ts";
import { startHerdrDashboardServer } from "../server/server.ts";
import type { HerdrDashboardServerHandle } from "../types.ts";
import { webViewSupported } from "../../webview-console.ts";
import type { HealthCheck } from "../../health-check.ts";

export type DashboardAutomationGateFailureCode =
  | "webview_unsupported"
  | "bun_image_unsupported"
  | "smoke_failed"
  | "thumbnail_unavailable"
  | "thumbnail_invalid";

export interface DashboardAutomationGateFailure {
  code: DashboardAutomationGateFailureCode;
  message: string;
  detail?: string;
}

export interface DashboardAutomationThumbnailProbe {
  ok: boolean;
  status: number;
  contentType?: string;
  cache?: string;
}

export interface DashboardAutomationGateResult {
  ok: boolean;
  url: string;
  /** True when the gate started an ephemeral dashboard server (default mode). */
  ownedServer: boolean;
  smoke?: DashboardAutomationSmokeResult;
  thumbnail?: DashboardAutomationThumbnailProbe;
  failure?: DashboardAutomationGateFailure;
}

export interface RunDashboardAutomationGateOptions {
  /** Dashboard base URL. When omitted, starts an ephemeral server on port 0. */
  url?: string;
  projectPath?: string;
  readyTimeoutMs?: number;
  processesTimeoutMs?: number;
  thumbnailTimeoutMs?: number;
}

export interface ResolveDashboardAutomationUrlOptions {
  url?: string;
}

/** Resolve dashboard base URL for automation gate (--url, --dashboard-url, HERDR_DASHBOARD_URL). */
export function resolveDashboardAutomationUrl(
  options: ResolveDashboardAutomationUrlOptions = {}
): string | undefined {
  const fromFlag = options.url?.trim();
  if (fromFlag) return normalizeDashboardBaseUrl(fromFlag);
  const fromEnv = (Bun.env.HERDR_DASHBOARD_URL ?? "").trim();
  if (fromEnv) return normalizeDashboardBaseUrl(fromEnv);
  return undefined;
}

export async function probeDashboardThumbnail(
  baseUrl: string,
  opts?: {
    timeoutMs?: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<DashboardAutomationThumbnailProbe> {
  const timeoutMs = opts?.timeoutMs ?? 8_000;
  const pollMs = opts?.pollMs ?? 300;
  const thumbnailUrl = `${normalizeDashboardBaseUrl(baseUrl)}api/thumbnail?width=160&height=90&quality=75`;
  let terminal: DashboardAutomationThumbnailProbe = { ok: false, status: 404 };

  await pollUntil(
    async () => {
      try {
        const res = (await fetch(thumbnailUrl, {
          signal: AbortSignal.timeout(5_000),
        })) as unknown as {
          ok: boolean;
          status: number;
          headers: { get(name: string): string | null };
        };
        const contentType = res.headers.get("content-type") ?? undefined;
        const cache = res.headers.get("x-thumbnail-cache") ?? undefined;
        if (res.ok && contentType === "image/webp") {
          terminal = { ok: true, status: res.status, contentType, cache };
          return true;
        }
        if (res.status === 404) return false;
        terminal = { ok: false, status: res.status, contentType, cache };
        return true;
      } catch {
        return false;
      }
    },
    { timeoutMs, pollMs, now: opts?.now, sleep: opts?.sleep }
  );

  return terminal;
}

function smokeActionsForMode(ownedServer: boolean, processesTimeoutMs?: number) {
  return dashboardSmokeActions(processesTimeoutMs).map((action) =>
    action.type === "screenshot" && !ownedServer ? { ...action, feed: false } : action
  );
}

async function runExternalAutomationGate(
  baseUrl: string,
  options: RunDashboardAutomationGateOptions
): Promise<Pick<DashboardAutomationGateResult, "smoke" | "thumbnail" | "failure">> {
  try {
    await using view = new Bun.WebView({ width: 1280, height: 800, url: baseUrl });
    await runDashboardAutomation({
      view,
      actions: smokeActionsForMode(false, options.processesTimeoutMs),
      waitReady: true,
      readyTimeoutMs: options.readyTimeoutMs,
    });

    const bodyRowCount = Number(
      await view.evaluate(`document.querySelectorAll("#processes-body tr").length`)
    );
    const processRowCount = Number(
      await view.evaluate(`document.querySelectorAll(".processes-row").length`)
    );

    const smoke: DashboardAutomationSmokeResult = { pngBytes: 0, bodyRowCount, processRowCount };
    if (bodyRowCount === 0) {
      return {
        smoke,
        failure: {
          code: "smoke_failed",
          message: "processes panel did not render rows after toggle",
        },
      };
    }

    const thumbnail = await probeDashboardThumbnail(baseUrl, {
      timeoutMs: options.thumbnailTimeoutMs,
    });
    if (!thumbnail.ok) {
      return {
        smoke,
        thumbnail,
        failure: {
          code: "thumbnail_unavailable",
          message: `GET ${baseUrl}api/thumbnail did not return image/webp`,
          detail:
            "External --url mode cannot call setScreenshotPng on a remote serve shell. Omit --url for self-contained E2E, or run dashboard in --webview mode with screenshot feed.",
        },
      };
    }

    return { smoke, thumbnail };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : Bun.inspect(error);
    return {
      failure: { code: "smoke_failed", message },
    };
  }
}

async function runOwnedAutomationGate(
  projectPath: string,
  options: RunDashboardAutomationGateOptions
): Promise<Pick<DashboardAutomationGateResult, "url" | "smoke" | "thumbnail" | "failure">> {
  const server = startHerdrDashboardServer({
    projectPath,
    port: 0,
    sessions: false,
    dryRun: true,
    webview: { shell: "serve" },
  });

  try {
    await using view = new Bun.WebView({ width: 1280, height: 800, url: server.url });
    const serverHandle: Pick<HerdrDashboardServerHandle, "setScreenshotPng"> = server;
    const smoke = await runDashboardAutomationSmoke({
      server: serverHandle,
      view,
      readyTimeoutMs: options.readyTimeoutMs,
      processesTimeoutMs: options.processesTimeoutMs,
    });

    const thumbnail = await probeDashboardThumbnail(server.url, {
      timeoutMs: options.thumbnailTimeoutMs,
    });
    if (!thumbnail.ok) {
      return {
        url: server.url,
        smoke,
        thumbnail,
        failure: {
          code: "thumbnail_unavailable",
          message: "dashboard automation ran but /api/thumbnail did not return image/webp",
        },
      };
    }

    if (thumbnail.contentType !== "image/webp") {
      return {
        url: server.url,
        smoke,
        thumbnail,
        failure: {
          code: "thumbnail_invalid",
          message: `unexpected thumbnail content-type: ${thumbnail.contentType ?? "missing"}`,
        },
      };
    }

    return { url: server.url, smoke, thumbnail };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : Bun.inspect(error);
    return {
      url: server.url,
      failure: { code: "smoke_failed", message },
    };
  } finally {
    server.stop();
  }
}

/** Run declarative dashboard smoke actions and assert /api/thumbnail end-to-end. */
export async function runDashboardAutomationGate(
  options: RunDashboardAutomationGateOptions = {}
): Promise<DashboardAutomationGateResult> {
  if (!webViewSupported()) {
    return {
      ok: false,
      url: resolveDashboardAutomationUrl(options) ?? resolveDashboardMetaUrl(),
      ownedServer: false,
      failure: {
        code: "webview_unsupported",
        message: "Bun.WebView is not available on this platform",
      },
    };
  }

  if (!bunImageSupported()) {
    return {
      ok: false,
      url: resolveDashboardAutomationUrl(options) ?? resolveDashboardMetaUrl(),
      ownedServer: false,
      failure: {
        code: "bun_image_unsupported",
        message: "Bun.Image is not available — /api/thumbnail encode cannot run",
      },
    };
  }

  const externalUrl = resolveDashboardAutomationUrl(options);
  const projectPath = options.projectPath ?? process.cwd();

  if (externalUrl) {
    const partial = await runExternalAutomationGate(externalUrl, options);
    return {
      ok: !partial.failure,
      url: externalUrl,
      ownedServer: false,
      ...partial,
    };
  }

  const partial = await runOwnedAutomationGate(projectPath, options);
  return {
    ok: !partial.failure,
    ownedServer: true,
    ...partial,
    url: partial.url ?? resolveDashboardMetaUrl(),
  };
}

export function formatDashboardAutomationGateStatusLine(
  result: DashboardAutomationGateResult
): string {
  if (result.ok && result.smoke) {
    const thumb = result.thumbnail?.cache ? ` · thumbnail ${result.thumbnail.cache}` : "";
    return `${result.url} · smoke png ${result.smoke.pngBytes}B · rows ${result.smoke.bodyRowCount}${thumb}`;
  }
  return result.failure?.message ?? "dashboard automation gate failed";
}

export interface DashboardAutomationJsonEnvelope {
  dashboardAutomation?: DashboardAutomationGateResult;
  summary?: { ok: boolean };
}

export function dashboardAutomationChecksFromResult(
  result: DashboardAutomationGateResult
): HealthCheck[] {
  if (result.ok) {
    return [
      {
        name: "dashboard-automation",
        status: "ok",
        message: formatDashboardAutomationGateStatusLine(result),
        fixable: false,
      },
    ];
  }

  const failure = result.failure;
  const message = failure?.detail
    ? `${failure.message}\n  ${failure.detail}`
    : (failure?.message ?? "dashboard automation gate failed");

  return [
    {
      name: "dashboard-automation",
      status: "error",
      message,
      fixable: failure?.code === "thumbnail_unavailable" || failure?.code === "smoke_failed",
      category: failure?.code ?? "dashboard_automation_gate_failed",
      autoFix: "kimi-doctor --automation",
    },
  ];
}
