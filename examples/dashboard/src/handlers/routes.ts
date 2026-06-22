/**
 * Dashboard static route table — SSOT for dispatchDashboardRoute().
 * Handlers remain in ./handlers/*.ts; this file only maps path → method → handler.
 */

import {
  apiBundle,
  apiCompile,
  apiGates,
  apiSecrets,
  apiConsoleDepth,
  apiEnv,
  apiBuildInfo,
  apiRuntimeInfo,
  apiToolchainHealth,
  apiToolchainHeal,
  apiDeps,
  apiInspect,
  apiInspectSimple,
  apiInspectConfig,
  apiBunfig,
  apiStringUtils,
  apiUuid,
} from "./api-handlers.ts";
import { apiArtifactGraphConvergenceSchema } from "./artifact-graph-convergence.ts";
import { apiBuildCompile } from "./bun-build.ts";
import { apiBunPm } from "./bun-pm.ts";
import { apiBunRuntime } from "./bun-runtime.ts";
import { apiBunTest } from "./bun-test.ts";
import { apiCanvases, apiCards, apiCanvasFilter } from "./canvas-cards.ts";
import { apiExec } from "./child-process.ts";
import { apiColor } from "./color.ts";
import { apiConfigStatus } from "./config-status.ts";
import { apiConsole } from "./console.ts";
import { apiCron } from "./cron.ts";
import { apiCryptoHash } from "./cryptohasher.ts";
import { apiDashboardSettings } from "./dashboard-settings.ts";
import { apiDeepEquals } from "./deep-equals.ts";
import { apiDeepMatch } from "./deep-match.ts";
import {
  apiEffectBenchmark,
  apiEffectBenchmarkRefresh,
  apiEffectBenchmarkTrain,
} from "./effect-benchmark.ts";
import { apiDotenv } from "./env-env.ts";
import { apiExamples, apiExamplesGates, apiExamplesTrading } from "./examples-showcase.ts";
import { apiExtractMethods } from "./extract-methods.ts";
import { apiFileIO } from "./file-i-o.ts";
import { apiFileSplit } from "./file-split.ts";
import { apiGlobOrphan } from "./glob-orphan.ts";
import { apiGlob } from "./glob.ts";
import { apiGlobalStore } from "./global-store.ts";
import { apiHttp2 } from "./http-2.ts";
import { apiEffectImage } from "./effect-image.ts";
import { apiImage } from "./image.ts";
import { apiInspectDefaults } from "./inspect-defaults.ts";
import { apiInspectTable } from "./inspect-table.ts";
import { apiIpcMatrix } from "./ipc-matrix.ts";
import { apiIpc } from "./ipc.ts";
import { apiKimiDoctor } from "./kimi-doctor.ts";
import { apiKimiPublish } from "./kimi-publish.ts";
import { apiMarkdownHtml, apiMarkdownAnsi } from "./markdown.ts";
import { apiMetricsSchema } from "./metrics-schema.ts";
import { apiNanoseconds } from "./nanoseconds.ts";
import { apiNodeHttp } from "./node-http.ts";
import { apiOsInfo } from "./os-info.ts";
import { apiPassword } from "./password.ts";
import { apiPeek } from "./peek.ts";
import { apiPerfAutoDiscover } from "./perf-auto-discover.ts";
import { apiPerfHarness, apiPerfRegistry, apiPerfTrain, apiPerfReport } from "./perf-registry.ts";
import { apiPerfThreaded } from "./perf-threaded.ts";
import { apiRandomBytes } from "./random-bytes.ts";
import { apiScaffold } from "./scaffold.ts";
import { apiSemver } from "./semver.ts";
import { apiSetHeaders } from "./set-headers.ts";
import { apiShadowRealm } from "./shadowrealm.ts";
import { apiShell } from "./shell.ts";
import { apiSleep } from "./sleep.ts";
import { apiWriteSmart } from "./smart-write.ts";
import { apiSpawnSync } from "./spawn-sync.ts";
import { apiSqlite } from "./sqlite.ts";
import { apiStreamHash } from "./stream-hash.ts";
import { apiStripAnsi } from "./strip-ansi.ts";
import { apiSymbols } from "./symbols.ts";
import { apiTerminal } from "./terminal.ts";
import { apiThresholdOverrides } from "./threshold-overrides.ts";
import { apiTraceVerify } from "./trace-verify.ts";
import { apiTranspilerScan } from "./transpiler-scan.ts";
import { apiTranspiler } from "./transpiler.ts";
import { apiTty } from "./tty.ts";
import { apiUrlNode } from "./url-node.ts";
import { apiUrl } from "./url-urlsearchparams.ts";
import { apiUtilTypes } from "./util-types.ts";
import { apiVmContext } from "./vm-context.ts";
import { readBenchmarkHealthCheck } from "../../../../src/lib/effect-benchmark-card.ts";
import { dashboardAssetResponse, type DashboardStaticAsset } from "../lib/dashboard-assets.ts";
import { resolveRoot, type DashboardHttpMethod } from "./shared.ts";

export type DashboardRouteHandler = (req: Request) => Response | Promise<Response>;

export interface DashboardStaticRoute {
  path: string;
  methods: readonly DashboardHttpMethod[];
  handler: DashboardRouteHandler;
}

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
} as const;

function serveDashboardAsset(asset: DashboardStaticAsset): Response {
  return dashboardAssetResponse(asset);
}

function route(
  path: string,
  handler: DashboardRouteHandler,
  methods: readonly DashboardHttpMethod[] = ["GET"]
): DashboardStaticRoute {
  return { path, methods, handler };
}

function route0(
  path: string,
  handler: () => Response | Promise<Response>,
  methods: readonly DashboardHttpMethod[] = ["GET"]
): DashboardStaticRoute {
  return route(path, () => handler(), methods);
}

async function apiHealth(req: Request): Promise<Response> {
  const headers = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  };
  if (req.method === "HEAD") return new Response(null, { status: 200, headers });
  const benchmark = await readBenchmarkHealthCheck(resolveRoot());
  const ok = benchmark.status !== "error";
  return new Response(
    JSON.stringify({ ok, checks: { benchmark }, fetchedAt: new Date().toISOString() }, null, 2),
    { status: 200, headers }
  );
}

/** Static switch routes (URLPattern artifact routes are handled earlier in index.ts). */
export const DASHBOARD_STATIC_ROUTES: readonly DashboardStaticRoute[] = [
  route(
    "/",
    () => new Response(Bun.file(import.meta.dir + "/../dashboard.html"), { headers: HTML_HEADERS })
  ),
  route("/dashboard.css", () => serveDashboardAsset("dashboard.css")),
  route("/dashboard-core.js", () => serveDashboardAsset("dashboard-core.js")),
  route("/dashboard.js", () => serveDashboardAsset("dashboard.js")),
  route0("/health", () => new Response("ok")),
  route("/api/health", apiHealth, ["GET", "HEAD"]),
  route0("/api/bundle", apiBundle),
  route0("/api/compile", apiCompile),
  route0("/api/gates", apiGates),
  route0("/api/secrets", apiSecrets),
  route0("/api/console-depth", apiConsoleDepth),
  route0("/api/console", apiConsole),
  route0("/api/tty", apiTty),
  route0("/api/terminal", apiTerminal),
  route0("/api/color", apiColor),
  route0("/api/peek", apiPeek),
  route0("/api/http2", apiHttp2),
  route0("/api/url", apiUrl),
  route0("/api/url-node", apiUrlNode),
  route0("/api/password", apiPassword),
  route0("/api/crypto-hash", apiCryptoHash),
  route0("/api/sqlite", apiSqlite),
  route0("/api/file-io", apiFileIO),
  route0("/api/glob", apiGlob),
  route0("/api/glob-orphan", apiGlobOrphan),
  route0("/api/util-types", apiUtilTypes),
  route0("/api/write-smart", apiWriteSmart),
  route0("/api/stream-hash", apiStreamHash),
  route0("/api/node-http", apiNodeHttp),
  route0("/api/exec", apiExec),
  route0("/api/ipc", apiIpc),
  route0("/api/spawn-sync", apiSpawnSync),
  route0("/api/image", apiImage),
  route0("/api/perf-harness", apiPerfHarness),
  route0("/api/perf-registry", apiPerfRegistry),
  route0("/api/perf-train", apiPerfTrain),
  route0("/api/perf-report", apiPerfReport),
  route0("/api/perf-auto-discover", apiPerfAutoDiscover),
  route0("/api/threshold-overrides", apiThresholdOverrides),
  route0("/api/kimi-publish", apiKimiPublish),
  route0("/api/scaffold", apiScaffold),
  route0("/api/file-split", apiFileSplit),
  route0("/api/effect-image", apiEffectImage),
  route0("/api/extract-methods", apiExtractMethods),
  route0("/api/transpiler-scan", apiTranspilerScan),
  route0("/api/shadow-realm", apiShadowRealm),
  route0("/api/vm-context", apiVmContext),
  route0("/api/ipc-matrix", apiIpcMatrix),
  route0("/api/symbols", apiSymbols),
  route0("/api/set-headers", apiSetHeaders),
  route0("/api/metrics-schema", apiMetricsSchema),
  route0("/api/kimi-doctor", apiKimiDoctor),
  route0("/api/perf-threaded", apiPerfThreaded),
  route("/api/effect-benchmark/refresh", () => apiEffectBenchmarkRefresh(), ["POST"]),
  route("/api/effect-benchmark/train", () => apiEffectBenchmarkTrain(), ["POST"]),
  route0("/api/effect-benchmark", apiEffectBenchmark),
  route0("/api/config-status", apiConfigStatus),
  route0("/api/bun-runtime", apiBunRuntime),
  route0("/api/bun-pm", apiBunPm),
  route0("/api/global-store", apiGlobalStore),
  route0("/api/trace-verify", apiTraceVerify),
  route0("/api/deep-match", apiDeepMatch),
  route0("/api/bun-test", apiBunTest),
  route0("/api/build-compile", apiBuildCompile),
  route0("/api/strip-ansi", apiStripAnsi),
  route0("/api/shell", apiShell),
  route0("/api/cron", apiCron),
  route0("/api/transpiler", apiTranspiler),
  route0("/api/os", apiOsInfo),
  route0("/api/random-bytes", apiRandomBytes),
  route0("/api/inspect-defaults", apiInspectDefaults),
  route0("/api/dotenv", apiDotenv),
  route("/api/env", apiEnv),
  route0("/api/build-info", apiBuildInfo),
  route0("/api/runtime-info", apiRuntimeInfo),
  route0("/api/toolchain/health", apiToolchainHealth),
  route0("/api/toolchain/heal", apiToolchainHeal),
  route0("/api/deps", apiDeps),
  route0("/api/inspect", apiInspect),
  route0("/api/inspect-table", apiInspectTable),
  route0("/api/inspect-simple", apiInspectSimple),
  route0("/api/inspect-config", apiInspectConfig),
  route0("/api/bunfig", apiBunfig),
  route0("/api/string-utils", apiStringUtils),
  route0("/api/uuid", apiUuid),
  route0("/api/markdown/html", apiMarkdownHtml),
  route0("/api/markdown/ansi", apiMarkdownAnsi),
  route0("/api/semver", apiSemver),
  route0("/api/deep-equals", apiDeepEquals),
  route0("/api/nanoseconds", apiNanoseconds),
  route0("/api/sleep", apiSleep),
  route0("/api/artifact-graph-convergence/schema", apiArtifactGraphConvergenceSchema),
  route("/api/canvases", apiCanvases),
  route("/api/cards", apiCards),
  route("/api/canvas-filter", apiCanvasFilter),
  route("/api/examples", apiExamples),
  route0("/api/examples/trading", apiExamplesTrading),
  route0("/api/examples/gates", apiExamplesGates),
  route("/api/settings", apiDashboardSettings),
] as const;

export const ROUTE_BY_PATH: ReadonlyMap<string, DashboardStaticRoute> = new Map(
  DASHBOARD_STATIC_ROUTES.map((entry) => [entry.path, entry])
);
