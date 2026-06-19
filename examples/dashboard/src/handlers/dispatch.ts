/** Dashboard static route dispatch — handlers are SSOT in ./handlers/*.ts */

import { apiBundle, apiCompile, apiGates, apiSecrets, apiConsoleDepth, apiEnv, apiBuildInfo, apiRuntimeInfo, apiToolchainHealth, apiToolchainHeal, apiDeps, apiInspect, apiInspectSimple, apiInspectConfig, apiBunfig, apiStringUtils, apiUuid } from "./api-handlers.ts";
import { apiBuildCompile } from "./bun-build.ts";
import { apiBunTest } from "./bun-test.ts";
import { apiCanvases, apiCards, apiCanvasFilter } from "./canvas-cards.ts";
import { apiExec } from "./child-process.ts";
import { apiColor } from "./color.ts";
import { apiConsole } from "./console.ts";
import { apiCron } from "./cron.ts";
import { apiCryptoHash } from "./cryptohasher.ts";
import { apiDashboardSettings } from "./dashboard-settings.ts";
import { apiDeepEquals } from "./deep-equals.ts";
import { apiDeepMatch } from "./deep-match.ts";
import { apiEffectBenchmark } from "./effect-benchmark.ts";
import { apiEffectImage } from "./effect-image.ts";
import { apiDotenv } from "./env-env.ts";
import { apiExamples, apiExamplesTrading } from "./examples-showcase.ts";
import { apiExtractMethods } from "./extract-methods.ts";
import { apiFileIO } from "./file-i-o.ts";
import { apiFileSplit } from "./file-split.ts";
import { apiGlobOrphan } from "./glob-orphan.ts";
import { apiGlob } from "./glob.ts";
import { apiGlobalStore } from "./global-store.ts";
import { apiHttp2 } from "./http-2.ts";
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
import { apiUrlNode } from "./url-node-url.ts";
import { apiUrl } from "./url-urlsearchparams.ts";
import { apiUtilTypes } from "./util-types.ts";
import { apiVmContext } from "./vm-context.ts";

export async function dispatchDashboardRoute(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  switch (url.pathname) {
    case "/":
      return new Response(Bun.file(import.meta.dir + "/../dashboard.html"), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    case "/api/bundle":
      return apiBundle();
    case "/api/compile":
      return apiCompile();
    case "/api/gates":
      return apiGates();
    case "/api/secrets":
      return apiSecrets();
    case "/api/console-depth":
      return apiConsoleDepth();
    case "/api/console":
      return apiConsole();
    case "/api/tty":
      return apiTty();
    case "/api/terminal":
      return apiTerminal();
    case "/api/color":
      return apiColor();
    case "/api/peek":
      return apiPeek();
    case "/api/http2":
      return apiHttp2();
    case "/api/url":
      return apiUrl();
    case "/api/url-node":
      return apiUrlNode();
    case "/api/password":
      return apiPassword();
    case "/api/crypto-hash":
      return apiCryptoHash();
    case "/api/sqlite":
      return apiSqlite();
    case "/api/file-io":
      return apiFileIO();
    case "/api/glob":
      return apiGlob();
    case "/api/glob-orphan":
      return apiGlobOrphan();
    case "/api/util-types":
      return apiUtilTypes();
    case "/api/write-smart":
      return apiWriteSmart();
    case "/api/stream-hash":
      return apiStreamHash();
    case "/api/node-http":
      return apiNodeHttp();
    case "/api/exec":
      return apiExec();
    case "/api/ipc":
      return apiIpc();
    case "/api/spawn-sync":
      return apiSpawnSync();
    case "/api/image":
      return apiImage();
    case "/api/perf-harness":
      return apiPerfHarness();
    case "/api/perf-registry":
      return apiPerfRegistry();
    case "/api/perf-train":
      return apiPerfTrain();
    case "/api/perf-report":
      return apiPerfReport();
    case "/api/perf-auto-discover":
      return apiPerfAutoDiscover();
    case "/api/threshold-overrides":
      return apiThresholdOverrides();
    case "/api/kimi-publish":
      return apiKimiPublish();
    case "/api/scaffold":
      return apiScaffold();
    case "/api/file-split":
      return apiFileSplit();
    case "/api/effect-image":
      return apiEffectImage();
    case "/api/extract-methods":
      return apiExtractMethods();
    case "/api/transpiler-scan":
      return apiTranspilerScan();
    case "/api/shadow-realm":
      return apiShadowRealm();
    case "/api/vm-context":
      return apiVmContext();
    case "/api/ipc-matrix":
      return apiIpcMatrix();
    case "/api/symbols":
      return apiSymbols();
    case "/api/set-headers":
      return apiSetHeaders();
    case "/api/metrics-schema":
      return apiMetricsSchema();
    case "/api/kimi-doctor":
      return apiKimiDoctor();
    case "/api/perf-threaded":
      return apiPerfThreaded();
    case "/api/effect-benchmark":
      return apiEffectBenchmark();
    case "/api/global-store":
      return apiGlobalStore();
    case "/api/trace-verify":
      return apiTraceVerify();
    case "/api/deep-match":
      return apiDeepMatch();
    case "/api/bun-test":
      return apiBunTest();
    case "/api/build-compile":
      return apiBuildCompile();
    case "/api/strip-ansi":
      return apiStripAnsi();
    case "/api/shell":
      return apiShell();
    case "/api/cron":
      return apiCron();
    case "/api/transpiler":
      return apiTranspiler();
    case "/api/os":
      return apiOsInfo();
    case "/api/random-bytes":
      return apiRandomBytes();
    case "/api/inspect-defaults":
      return apiInspectDefaults();
    case "/api/dotenv":
      return apiDotenv();
    case "/api/env":
      return apiEnv(req);
    case "/api/build-info":
      return apiBuildInfo();
    case "/api/runtime-info":
      return apiRuntimeInfo();
    case "/api/toolchain/health":
      return apiToolchainHealth();
    case "/api/toolchain/heal":
      return apiToolchainHeal();
    case "/api/deps":
      return apiDeps();
    case "/api/inspect":
      return apiInspect();
    case "/api/inspect-table":
      return apiInspectTable();
    case "/api/inspect-simple":
      return apiInspectSimple();
    case "/api/inspect-config":
      return apiInspectConfig();
    case "/api/bunfig":
      return apiBunfig();
    case "/api/string-utils":
      return apiStringUtils();
    case "/api/uuid":
      return apiUuid();
    case "/api/markdown/html":
      return apiMarkdownHtml();
    case "/api/markdown/ansi":
      return apiMarkdownAnsi();
    case "/api/semver":
      return apiSemver();
    case "/api/deep-equals":
      return apiDeepEquals();
    case "/api/nanoseconds":
      return apiNanoseconds();
    case "/api/sleep":
      return apiSleep();
    case "/api/canvases":
      return apiCanvases();
    case "/api/cards":
      return apiCards(req);
    case "/api/canvas-filter":
      return apiCanvasFilter(req);
    case "/api/examples":
      return apiExamples(req);
    case "/api/examples/trading":
      return apiExamplesTrading();
    case "/api/settings":
      return apiDashboardSettings(req);
    case "/api/health": {
      const headers = { "cache-control": "no-store" };
      if (req.method === "HEAD") return new Response(null, { status: 200, headers });
      if (req.method === "GET") return new Response("ok", { status: 200, headers });
      return new Response("Method Not Allowed", { status: 405 });
    }
    case "/health":
      return new Response("ok");
    default:
      return null;
  }
}
