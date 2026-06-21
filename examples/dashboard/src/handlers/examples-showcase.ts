import { join } from "path";
import {
  buildExamplesShowcasePayload,
  probeGatesExample,
  probeTradingWorkspace,
  type ExamplesShowcaseSettings,
} from "../../../../src/lib/examples-showcase.ts";
import { resolveDashboardSettings } from "../../../../src/lib/dashboard-settings.ts";
import { jsonResponse } from "./api-handlers.ts";

const REPO_ROOT = join(import.meta.dir, "../../../..");

function toShowcaseSettings(
  settings: Awaited<ReturnType<typeof resolveDashboardSettings>>
): ExamplesShowcaseSettings {
  return {
    port: settings.port,
    probePort: settings.probePort,
    probeHost: settings.probeHost,
    canonicalPort: settings.canonicalPort,
    dashboardUrl: `http://127.0.0.1:${settings.port}/`,
  };
}

export async function apiExamples(request?: Request): Promise<Response> {
  const url = request ? new URL(request.url) : null;
  const id = url?.searchParams.get("id") ?? url?.searchParams.get("example");
  const resolved = await resolveDashboardSettings(REPO_ROOT, {
    requestUrl: url ?? undefined,
  });
  return jsonResponse(
    buildExamplesShowcasePayload(REPO_ROOT, {
      id,
      settings: toShowcaseSettings(resolved),
    })
  );
}

export function apiExamplesTrading(): Response {
  return jsonResponse({
    ok: true,
    schemaVersion: 1,
    project: "trading-workspace",
    ...probeTradingWorkspace(REPO_ROOT),
    fetchedAt: new Date().toISOString(),
  });
}

export function apiExamplesGates(): Response {
  return jsonResponse({
    ok: true,
    schemaVersion: 1,
    project: "gates",
    ...probeGatesExample(REPO_ROOT),
    fetchedAt: new Date().toISOString(),
  });
}
