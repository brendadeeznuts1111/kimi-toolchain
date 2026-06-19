// ── Server ──────────────────────────────────────────────────────────

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/":
        return new Response(Bun.file(import.meta.dir + "/dashboard.html"), {
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
        return apiEnv();
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
      case "/health":
        return new Response("ok");
      default:
        return new Response("Not Found", { status: 404 });
    }
  },
});

Bun.stdout.write(`Dashboard running at http://localhost:${server.port}\n`);

