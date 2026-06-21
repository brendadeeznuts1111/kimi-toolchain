import {
  buildExamplesShowcasePayload,
  probeGatesExample,
  probeTradingWorkspace,
  type ExamplesShowcaseSettings,
} from "../../../../src/lib/examples-showcase.ts";
import {
  resolveDashboardProjectRoot,
  resolveDashboardSettings,
} from "../../../../src/lib/dashboard-settings.ts";
import { jsonResponse } from "./api-handlers.ts";

const repoRoot = () => resolveDashboardProjectRoot(import.meta.dir);

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
  const root = repoRoot();
  const resolved = await resolveDashboardSettings(root, {
    requestUrl: url ?? undefined,
  });
  return jsonResponse(
    buildExamplesShowcasePayload(root, {
      id,
      settings: toShowcaseSettings(resolved),
    })
  );
}

export function apiExamplesTrading(): Response {
  const root = repoRoot();
  return jsonResponse({
    ok: true,
    schemaVersion: 1,
    project: "trading-workspace",
    ...probeTradingWorkspace(root),
    fetchedAt: new Date().toISOString(),
  });
}

export function apiExamplesGates(): Response {
  const root = repoRoot();
  return jsonResponse({
    ok: true,
    schemaVersion: 1,
    project: "gates",
    ...probeGatesExample(root),
    fetchedAt: new Date().toISOString(),
  });
}