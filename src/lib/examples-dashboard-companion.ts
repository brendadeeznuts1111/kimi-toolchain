/**
 * Examples dashboard companion — resolve URL from dx.config / env and optionally
 * start `PORT=<n> bun run dashboard` when the Herdr dashboard Examples tab needs it.
 */

import { join } from "path";
import { pathExists } from "./bun-io.ts";
import { readTomlDocument, resolveProjectConfigPath } from "./dx-config-parse.ts";
import { withBunNoOrphans } from "./tool-runner.ts";

export const DEFAULT_EXAMPLES_DASHBOARD_URL = "http://127.0.0.1:5678/";
const HEALTH_PROBE_MS = 1200;
const STARTUP_POLL_MS = 200;
const STARTUP_TIMEOUT_MS = 12_000;

let companionProc: Bun.Subprocess | "external" | null = null;

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return DEFAULT_EXAMPLES_DASHBOARD_URL;
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function dashboardScriptPath(projectRoot: string): string | null {
  const script = join(projectRoot, "examples", "dashboard", "src", "index.ts");
  return pathExists(script) ? script : null;
}

/** Probe examples dashboard `/health` (same contract as Herdr `/api/examples/health`). */
export async function fetchExamplesDashboardHealth(url: string): Promise<Record<string, unknown>> {
  const checkedAt = new Date().toISOString();
  const base = normalizeBaseUrl(url);
  const healthUrl = (() => {
    try {
      return new URL("/health", base).toString();
    } catch {
      return null;
    }
  })();
  if (!healthUrl) {
    return { ok: false, url: base, checkedAt, error: "invalid examples dashboard URL" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_PROBE_MS);
  try {
    const res = await fetch(healthUrl, { signal: controller.signal });
    return {
      ok: res.ok,
      url: base,
      healthUrl,
      status: res.status,
      checkedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : Bun.inspect(err);
    return {
      ok: false,
      url: base,
      healthUrl,
      checkedAt,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Resolve Examples tab iframe base URL: env → dx.config → default :5678. */
export async function resolveExamplesDashboardUrl(projectRoot: string): Promise<string> {
  const envUrl = Bun.env.HERDR_EXAMPLES_DASHBOARD_URL?.trim();
  if (envUrl) return normalizeBaseUrl(envUrl);

  const configPath = resolveProjectConfigPath(projectRoot);
  if (configPath) {
    const doc = await readTomlDocument(configPath);
    const herdr = doc.herdr;
    if (herdr && typeof herdr === "object" && !Array.isArray(herdr)) {
      const orchestrator = (herdr as Record<string, unknown>).orchestrator;
      if (orchestrator && typeof orchestrator === "object" && !Array.isArray(orchestrator)) {
        const dashboard = (orchestrator as Record<string, unknown>).dashboard;
        if (dashboard && typeof dashboard === "object" && !Array.isArray(dashboard)) {
          const row = dashboard as Record<string, unknown>;
          const configured =
            typeof row.examplesUrl === "string"
              ? row.examplesUrl.trim()
              : typeof row.examples_url === "string"
                ? row.examples_url.trim()
                : "";
          if (configured) return normalizeBaseUrl(configured);
        }
      }
    }
  }

  return DEFAULT_EXAMPLES_DASHBOARD_URL;
}

export interface EnsureExamplesDashboardOptions {
  /** Override resolved URL. */
  url?: string;
  /** When false, never spawn a companion process (default true). */
  autoStart?: boolean;
}

export interface EnsureExamplesDashboardResult {
  url: string;
  started: boolean;
}

async function waitForExamplesHealth(url: string, deadlineMs: number): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const health = await fetchExamplesDashboardHealth(url);
    if (health.ok) return true;
    await Bun.sleep(STARTUP_POLL_MS);
  }
  return false;
}

/** Ensure examples dashboard responds at the resolved URL; spawn companion when down. */
export async function ensureExamplesDashboardCompanion(
  projectRoot: string,
  options: EnsureExamplesDashboardOptions = {}
): Promise<EnsureExamplesDashboardResult> {
  const url = normalizeBaseUrl(options.url ?? (await resolveExamplesDashboardUrl(projectRoot)));
  const initial = await fetchExamplesDashboardHealth(url);
  if (initial.ok) {
    return { url, started: false };
  }

  if (options.autoStart === false) {
    return { url, started: false };
  }

  const script = dashboardScriptPath(projectRoot);
  if (!script) {
    return { url, started: false };
  }

  let port = "5678";
  try {
    const parsed = new URL(url);
    if (parsed.port) port = parsed.port;
  } catch {
    // keep default
  }

  if (companionProc && companionProc !== "external") {
    try {
      companionProc.kill();
    } catch {
      // best-effort
    }
    companionProc = null;
  }

  companionProc = Bun.spawn(withBunNoOrphans(["bun", "run", script]), {
    cwd: join(projectRoot, "examples", "dashboard"),
    env: { ...Bun.env, PORT: port },
    stdout: "pipe",
    stderr: "pipe",
  });

  const ready = await waitForExamplesHealth(url, STARTUP_TIMEOUT_MS);
  if (!ready) {
    try {
      companionProc.kill();
    } catch {
      // best-effort
    }
    companionProc = null;
    return { url, started: false };
  }

  return { url, started: true };
}

/** Stop a companion process started by ensureExamplesDashboardCompanion. */
export function stopExamplesDashboardCompanion(): void {
  if (!companionProc || companionProc === "external") {
    companionProc = null;
    return;
  }
  try {
    companionProc.kill();
  } catch {
    // best-effort
  }
  companionProc = null;
}
