import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, pathExists, readText } from "../src/lib/bun-io.ts";
import { fetchJsonBody, readableStreamToText } from "../src/lib/bun-utils.ts";
import {
  DEFAULT_DASHBOARD_PORT,
  fetchDashboardRules,
  fetchDashboardCanvases,
  resolveDashboardCompanionContext,
  runDashboardAgentAction,
  runDashboardIpcCommand,
} from "../src/lib/herdr-dashboard-data.ts";
import { bunImageSupported } from "../src/lib/bun-image.ts";
import { HerdrDashboardDiscoveryCache } from "../src/lib/herdr-dashboard-discovery-cache.ts";

import { ArtifactStore } from "../src/lib/artifact-store.ts";
import { startProbeServer } from "../src/lib/card-probe-server.ts";
import {
  dashboardScreenshotPlaceholder,
  resolveHerdrDashboardHtmlPath,
  startHerdrDashboardServer,
} from "../src/lib/herdr-dashboard-server.ts";
import {
  buildDashboardWebViewOptions,
  createDashboardConsoleMirror,
  createDashboardWebViewConsole,
  IPC_CONSOLE_TAG,
  resolveDashboardWebViewConsole,
} from "../src/lib/herdr-webview-dashboard.ts";
import { webViewConsoleMirror } from "../src/lib/webview-console.ts";
import type { DashboardIpcCommand } from "../src/lib/herdr-dashboard-data.ts";
import { writeDashboardEvent } from "../src/lib/dashboard-audit-store.ts";
import { failureLedgerPath } from "../src/lib/paths.ts";
import { recordDoctorRun } from "../src/lib/utils.ts";
import {
  REPO_ROOT,
  captureConsole,
  cleanupPath,
  testTempDir,
  withEnv,
  writeText,
} from "./helpers.ts";

/** Fast gate: CLI --timeout 30000; slow tests need per-test override. */
const SERVER_TEST_MS = 20_000;

describe("herdr-dashboard-server", () => {
  test("DEFAULT_DASHBOARD_PORT is 18412", () => {
    expect(DEFAULT_DASHBOARD_PORT).toBe(18412);
  });

  test("fetchDashboardRules returns rule rows for kimi-toolchain", () => {
    const payload = fetchDashboardRules(REPO_ROOT, false);
    expect(payload.ok).toBe(true);
    expect(payload.logPath).toContain("handoff-log.jsonl");
    expect(Array.isArray(payload.rules)).toBe(true);
  });

  test("fetchDashboardCanvases returns all 13 cursorCanvas entries", async () => {
    const payload = await fetchDashboardCanvases();
    expect(payload.ok).toBe(true);
    expect(payload.canvases.length).toBe(13);

    const ids = payload.canvases.map((c) => c.id);
    expect(ids).toContain("unified");
    expect(ids).toContain("code-references");
    expect(ids).toContain("templates");
    expect(ids).toContain("configuration-layers");
    expect(ids).toContain("namespace");
    expect(ids).toContain("kimi-doctor");
    expect(ids).toContain("dashboard-thumbnails");
    expect(ids).toContain("herdr-plugin-architecture");
    expect(ids).toContain("deep-quality");
    expect(ids).toContain("benchmark");
  });

  test("fetchDashboardCanvases sorts by readOrder ascending", async () => {
    const payload = await fetchDashboardCanvases();
    const orders = payload.canvases.map((c) => c.readOrder ?? 99);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
    }
    // Hub (readOrder 1) must be first
    expect(payload.canvases[0].id).toBe("unified");
  });

  test("fetchDashboardCanvases entries have required metadata", async () => {
    const payload = await fetchDashboardCanvases();
    for (const c of payload.canvases) {
      expect(c.id).toBeTruthy();
      expect(c.canvasId).toBeTruthy();
      expect(c.page).toBeTruthy();
      expect(c.path).toMatch(/^docs\/canvases\/.+\.canvas\.tsx$/);
      expect(c.purpose).toBeTruthy();
    }
  });

  test(
    "GET /api/canvases passes runId into companion deep links",
    async () => {
      const dir = testTempDir("herdr-dashboard-api-canvases-");
      const store = new ArtifactStore(dir);
      await store.saveRunManifest({
        schemaVersion: 1,
        runId: "run_api_canvases",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: ["perf-gate"],
        artifacts: {},
        status: "pass",
      });

      const server = startHerdrDashboardServer({
        projectPath: dir,
        port: 0,
        sessions: false,
        herdrEvents: false,
        gateHealthWatch: false,
        metaWatch: false,
      });
      try {
        const explicit = await server.fetch(
          new Request(`${server.url}api/canvases?runId=run_api_explicit`)
        );
        expect(explicit.status).toBe(200);
        const explicitBody = (await explicit.json()) as {
          ok?: boolean;
          activeRunId?: string;
          canvases: Array<{ id: string; dashboardDeepLink?: string }>;
        };
        expect(explicitBody.ok).toBe(true);
        expect(explicitBody.activeRunId).toBe("run_api_explicit");
        const explicitLineage = explicitBody.canvases.find((c) => c.id === "artifact-lineage");
        expect(explicitLineage?.dashboardDeepLink).toContain("runId=run_api_explicit");

        const latest = await server.fetch(new Request(`${server.url}api/canvases`));
        expect(latest.status).toBe(200);
        const latestBody = (await latest.json()) as {
          ok?: boolean;
          activeRunId?: string;
          canvases: Array<{ id: string; dashboardDeepLink?: string }>;
        };
        expect(latestBody.activeRunId).toBe("run_api_canvases");
        const latestLineage = latestBody.canvases.find((c) => c.id === "artifact-lineage");
        expect(latestLineage?.dashboardDeepLink).toContain("runId=run_api_canvases");
      } finally {
        server.stop();
      }
      cleanupPath(dir);
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "GET /api/canvas-filter returns highlight action for artifact-lineage deep link",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
        herdrEvents: false,
        gateHealthWatch: false,
        metaWatch: false,
      });
      try {
        const res = await server.fetch(
          new Request(`${server.url}api/canvas-filter?canvas=artifact-lineage`)
        );
        expect(res.status).toBe(200);
        const payload = (await res.json()) as {
          ok?: boolean;
          action?: { kind?: string; canvas?: string; cardIds?: string[] };
        };
        expect(payload.ok).toBe(true);
        expect(payload.action?.kind).toBe("highlight");
        expect(payload.action?.canvas).toBe("artifact-lineage");
        expect(payload.action?.cardIds).toContain("card-artifacts");
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test("fetchDashboardCanvases code-references has optional metadata", async () => {
    const payload = await fetchDashboardCanvases();
    const entry = payload.canvases.find((c) => c.id === "code-references");
    expect(entry).toBeTruthy();
    expect(entry!.version).toBe("0.1.0");
    expect(entry!.layer).toBe("Doc URL lint");
    expect(entry!.openWhen).toContain("@see ladder");
    expect(entry!.readOrder).toBe(4);
  });

  test("fetchDashboardCanvases herdr-plugin-architecture has version 0.5.0", async () => {
    const payload = await fetchDashboardCanvases();
    const entry = payload.canvases.find((c) => c.id === "herdr-plugin-architecture");
    expect(entry).toBeTruthy();
    expect(entry!.version).toBe("0.5.0");
    expect(entry!.layer).toBe("Herdr plugins v0.5.0");
    expect(entry!.readOrder).toBe(8);
  });

  test("fetchDashboardCanvases exposes canvasInfluences as influences", async () => {
    const payload = await fetchDashboardCanvases();
    const deepQuality = payload.canvases.find((c) => c.id === "deep-quality");
    expect(deepQuality?.influences).toContain("card-gates");
    const templates = payload.canvases.find((c) => c.id === "templates");
    expect(templates?.influences).toContain("card-scaffold");
  });

  test("fetchDashboardCanvases exposes dashboardDeepLink for bridged manifests", async () => {
    const payload = await fetchDashboardCanvases();
    const lineage = payload.canvases.find((c) => c.id === "artifact-lineage");
    expect(lineage?.dashboardDeepLink).toContain("canvas=artifact-lineage");
    const gateHealth = payload.canvases.find((c) => c.id === "gate-health");
    expect(gateHealth?.dashboardDeepLink).toContain("canvas=gate-health");
    const benchmark = payload.canvases.find((c) => c.id === "benchmark");
    expect(benchmark?.dashboardDeepLink).toContain("canvas=benchmark");
    const unified = payload.canvases.find((c) => c.id === "unified");
    expect(unified?.dashboardDeepLink).toBeUndefined();
  });

  test("fetchDashboardCanvases honors explicit companion runId in deep links", async () => {
    const payload = await fetchDashboardCanvases({
      companion: { runId: "run_explicit_companion" },
    });
    expect(payload.activeRunId).toBe("run_explicit_companion");
    const lineage = payload.canvases.find((c) => c.id === "artifact-lineage");
    expect(lineage?.dashboardDeepLink).toContain("runId=run_explicit_companion");
  });

  test("fetchDashboardCanvases resolves latest run manifest for project companion links", async () => {
    const dir = testTempDir("herdr-dashboard-canvases-run-");
    const store = new ArtifactStore(dir);
    await store.saveRunManifest({
      schemaVersion: 1,
      runId: "run_companion_latest",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates: ["perf-gate"],
      artifacts: {},
      status: "pass",
    });

    const payload = await fetchDashboardCanvases({ projectPath: dir });
    expect(payload.activeRunId).toBe("run_companion_latest");
    const lineage = payload.canvases.find((c) => c.id === "artifact-lineage");
    expect(lineage?.dashboardDeepLink).toContain("runId=run_companion_latest");
    cleanupPath(dir);
  });

  test("resolveDashboardCompanionContext prefers explicit runId over latest manifest", async () => {
    const dir = testTempDir("herdr-dashboard-companion-ctx-");
    const store = new ArtifactStore(dir);
    await store.saveRunManifest({
      schemaVersion: 1,
      runId: "run_manifest_latest",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates: ["perf-gate"],
      artifacts: {},
      status: "pass",
    });

    const ctx = await resolveDashboardCompanionContext(dir, { runId: "run_query_override" });
    expect(ctx.runId).toBe("run_query_override");
    cleanupPath(dir);
  });

  test("createDashboardConsoleMirror exposes webView handler", () => {
    const handler = createDashboardConsoleMirror();
    expect(typeof handler).toBe("function");
    expect(() => handler("log", "probe")).not.toThrow();
  });

  test("buildDashboardWebViewOptions defaults to ephemeral dataStore", () => {
    const built = buildDashboardWebViewOptions("http://127.0.0.1:18412/");
    expect(built.constructorOptions.dataStore).toBe("ephemeral");
    expect(built.store.mode).toBe("ephemeral");
    expect(built.constructorOptions.width).toBe(1280);
    expect(built.constructorOptions.height).toBe(800);
    expect(built.constructorOptions.url).toBe("http://127.0.0.1:18412/");
  });

  test("buildDashboardWebViewOptions reuses resolvedStore without re-resolving", () => {
    const preResolved = {
      dataStore: "ephemeral" as const,
      mode: "ephemeral" as const,
    };
    const built = buildDashboardWebViewOptions("http://127.0.0.1:18412/", {
      resolvedStore: preResolved,
      persistProfile: true,
    });
    expect(built.store).toBe(preResolved);
    expect(built.constructorOptions.dataStore).toBe("ephemeral");
  });

  test("runDashboardAgentAction rejects remote without CLI delegation message", () => {
    const result = runDashboardAgentAction({
      action: "attach",
      agent: "kimi",
      host: "mac-studio",
      session: "work",
      paneId: "p1",
    });
    expect(result.ok).toBe(false);
    expect(result.command).toContain("herdr-orchestrator agent attach kimi");
  });

  test(
    "dashboard server serves HTML and meta API",
    async () => {
      const discoveryCache = new HerdrDashboardDiscoveryCache({
        projectPath: REPO_ROOT,
        fetchOpts: { sessions: false },
        ttlMs: 60_000,
        discover: async () => ({
          ok: true,
          projectPath: REPO_ROOT,
          agentCount: 0,
          agents: [],
          fetchedAt: new Date().toISOString(),
        }),
        probeRemoteHosts: async () => ({
          configured: 1,
          reachable: 1,
          hosts: [{ label: "staging", reachable: true, version: "0.9.4" }],
        }),
      });
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
        metaWatch: false,
        gateHealthWatch: false,
        discoveryCache,
      });
      try {
        const htmlRes = await server.fetch(new Request(server.url));
        const html = await htmlRes.text();
        expect(html).toContain("Herdr Orchestrator Dashboard");
        expect(html).toContain('href="herdr-dashboard.css"');
        expect(html).toContain('src="herdr-dashboard.js"');
        expect(html).toContain("Loading agents");
        expect(html).toContain("rules-meta-slot");
        expect(html).toContain("control-plane");
        expect(html).toContain("session-switcher-bar");
        expect(html).toContain("session-scope");
        expect(html).toContain("session-add-input");
        expect(html).toContain("session-remove-btn");
        expect(html).toContain("session-bun-mark");
        expect(html).toContain("artifacts-session-filter");
        expect(html).toContain("artifacts-runs-body");
        expect(html).toContain("artifacts-run-filter");
        expect(html).toContain("agents-heading");
        expect(html).toContain("agents-legend");
        expect(html).toContain("Upgrade scan");
        expect(html).toContain("Artifacts");
        expect(htmlRes.headers.get("access-control-allow-origin")).toBe("*");

        const cssRes = await server.fetch(new Request(`${server.url}herdr-dashboard.css`));
        const css = await cssRes.text();
        expect(css).toContain(":root");
        const jsRes = await server.fetch(new Request(`${server.url}herdr-dashboard.js`));
        const js = await jsRes.text();
        expect(js).toContain("STATIC_API_ORIGIN");
        expect(js).toContain("apiUrl");
        await server.hub.refresh();
        const metaRes = await server.fetch(new Request(`${server.url}api/meta`));
        expect(metaRes.headers.get("access-control-allow-origin")).toBe("*");
        const metaRaw = await metaRes.text();
        const meta = JSON.parse(metaRaw) as {
          ok: boolean;
          projectPath: string;
          pollHintMs: number;
          ssePollMs: number;
          cache?: { discovery: { hits: number }; status: { size: number } };
          herdrEvents?: { enabled: boolean };
          webview?: {
            shell: string;
            persistProfile: boolean;
            mode: string;
            defaultProfileDir: string;
          };
          discovery?: {
            herdrSession: string;
            herdrSessionLabel: string;
            mode: string;
            workspaceLabel: string | null;
            workspaceId: string | null;
            remoteHostsConfigured: number;
            remoteHosts?: {
              configured: number;
              reachable: number;
              hosts: Array<{ label: string; reachable: boolean; version?: string }>;
            };
            multiSessionEnabled: boolean;
            sessionsAvailable?: string[];
            sessionCatalog?: Array<{ session: string; reachable: boolean }>;
          };
          sse?: boolean;
          thumbnail?: boolean;
          thumbnailPath?: string;
          bunRuntimeCapabilities?: {
            aligned: boolean;
            capabilityCount: number;
            runtimeApiDocs: { globalsUrl: string };
          };
        };
        expect(meta.ok).toBe(true);
        expect(meta.projectPath).toBe(REPO_ROOT);
        expect(meta.pollHintMs).toBe(5000);
        expect(meta.ssePollMs).toBe(5000);
        expect(meta.cache?.discovery).toBeDefined();
        expect(meta.cache?.status).toBeDefined();
        expect(meta.herdrEvents?.enabled).toBe(true);
        expect(meta.webview?.shell).toBe("serve");
        expect(meta.webview?.mode).toBe("ephemeral");
        expect(meta.webview?.defaultProfileDir).toContain("herdr-orchestrator-dashboard-webview");
        expect(meta.discovery?.herdrSessionLabel).toBe("primary");
        expect(meta.discovery?.mode).toBe("workspace");
        expect(meta.discovery?.workspaceLabel).toBe("kimi-toolchain");
        expect(meta.discovery?.multiSessionEnabled).toBe(false);
        expect(meta.discovery?.sessionsAvailable).toEqual([""]);
        expect(meta.discovery?.remoteHostsConfigured).toBe(1);
        expect(meta.discovery?.remoteHosts?.configured).toBe(1);
        expect(meta.discovery?.remoteHosts?.reachable).toBe(1);
        expect(meta.discovery?.remoteHosts?.hosts[0]?.label).toBe("staging");
        expect(meta.sse).toBe(true);
        if (bunImageSupported()) {
          expect(meta.thumbnail).toBe(false);
          expect(meta.thumbnailPath).toBe("/api/thumbnail");
        }
        expect(meta.bunRuntimeCapabilities?.aligned).toBe(true);
        expect(meta.bunRuntimeCapabilities?.capabilityCount).toBe(17);
        expect(meta.bunRuntimeCapabilities?.runtimeApiDocs?.globalsUrl).toBe(
          "https://bun.com/docs/runtime/globals"
        );

        const preflightRes = (await fetch(`${server.url}api/heartbeats`, {
          method: "OPTIONS",
        })) as unknown as {
          status: number;
          headers: { get(name: string): string | null };
        };
        expect(preflightRes.status).toBe(204);
        expect(preflightRes.headers.get("access-control-allow-methods")).toContain("POST");
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server serves static API bridge assets with CORS",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
        herdrEvents: false,
        gateHealthWatch: false,
        metaWatch: false,
      });
      try {
        const cssRes = await server.fetch(new Request(`${server.url}herdr-dashboard.css`));
        expect(cssRes.status).toBe(200);
        expect(cssRes.headers.get("content-type")).toBe("text/css; charset=utf-8");
        expect(cssRes.headers.get("access-control-allow-origin")).toBe("*");
        expect(cssRes.headers.get("cache-control")).toBe("no-store");
        expect(await (cssRes as Response).text()).toContain(":root");

        const jsRes = await server.fetch(new Request(`${server.url}herdr-dashboard.js`));
        expect(jsRes.status).toBe(200);
        expect(jsRes.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
        expect(jsRes.headers.get("access-control-allow-origin")).toBe("*");
        expect(jsRes.headers.get("cache-control")).toBe("no-store");
        const js = await (jsRes as Response).text();
        expect(js).toContain("STATIC_API_ORIGIN");
        expect(js).toContain("function resolveFetchInput");
        expect(js).toContain("globalThis.fetch =");
        expect(js).toContain("function apiUrl");
        expect(js).toContain('input.pathname.startsWith("/api/")');
        expect(js).toContain("PANELS[activeTab]?.activate?.()");
        expect(js).toContain("refreshArtifactsRuns");
        expect(js).toContain("wireSessionBunMark");
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server serves bun-mark WebP",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
        herdrEvents: false,
        gateHealthWatch: false,
        metaWatch: false,
      });
      try {
        const res = await server.fetch(
          new Request(`${server.url}api/bun-mark?width=32&height=32&quality=82`)
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
        expect(res.headers.get("content-type")).toContain("image/webp");
        const bytes = await res.arrayBuffer();
        expect(bytes.byteLength).toBeGreaterThan(0);
        if (bunImageSupported()) {
          expect(bytes.byteLength).toBeGreaterThan(10);
        }

        const metaRes = await server.fetch(new Request(`${server.url}api/meta`));
        const meta = (await metaRes.json()) as {
          bunMarkPath?: string;
          effectImage?: { available?: boolean; markPath?: string };
        };
        expect(meta.bunMarkPath).toBe("/api/bun-mark");
        if (bunImageSupported()) {
          expect(meta.effectImage?.available).toBe(true);
          expect(meta.effectImage?.markPath).toBe("/api/bun-mark");
        }
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server handles CORS preflight for API routes",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
        herdrEvents: false,
        gateHealthWatch: false,
        metaWatch: false,
      });
      try {
        for (const path of [
          "api/events",
          "api/debug/logs",
          "api/artifacts/context",
          "api/widgets/logs",
        ]) {
          const res = await server.fetch(
            new Request(`${server.url}${path}`, {
              method: "OPTIONS",
              headers: {
                origin: "https://dashboard.example",
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type",
              },
            })
          );
          expect(res.status).toBe(204);
          expect(res.headers.get("access-control-allow-origin")).toBe("*");
          expect(res.headers.get("access-control-allow-methods")).toContain("GET");
          expect(res.headers.get("access-control-allow-methods")).toContain("POST");
          expect(res.headers.get("access-control-allow-methods")).toContain("OPTIONS");
          expect(res.headers.get("access-control-allow-headers")).toContain("content-type");
          expect(res.headers.get("cache-control")).toBe("no-store");
        }
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "served dashboard HTML has no duplicate nav tabs",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
        herdrEvents: false,
        gateHealthWatch: false,
        metaWatch: false,
      });
      try {
        const res = await server.fetch(new Request(server.url));
        const html = await readableStreamToText(res.body!);
        const tabs = [...html.matchAll(/<button\b[^>]*\bdata-tab="([^"]+)"/g)].map(
          (match) => match[1]!
        );
        const sections = new Set(
          [...html.matchAll(/<section\b[^>]*\bid="([^"]+)"[^>]*\bclass="panel\b/g)].map(
            (match) => match[1]!
          )
        );

        expect(tabs.length).toBeGreaterThan(0);
        expect(new Set(tabs).size).toBe(tabs.length);
        for (const tab of tabs) {
          expect(sections.has(tab)).toBe(true);
        }
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server artifacts API returns saved gate artifacts",
    async () => {
      const dir = testTempDir("herdr-dashboard-artifacts-");
      await Bun.write(
        join(dir, "dx.config.toml"),
        `[doctor.probe]\nport = 59123\nhost = "127.0.0.1"\n`
      );
      const store = new ArtifactStore(dir);
      await store.save("bunfig-policy", { status: "pass", message: "bunfig policy ok" });
      await store.save("card-probe", { ok: false, reason: "card probe failed" });
      await withEnv({ PROBE_SERVER_PORT: undefined, PROBE_SERVER_HOST: undefined }, async () => {
        const server = startHerdrDashboardServer({
          projectPath: dir,
          port: 0,
          sessions: false,
        });
        try {
          const res = (await fetch(`${server.url}api/artifacts`)) as unknown as {
            status: number;
            body: ReadableStream<Uint8Array>;
          };
          expect(res.status).toBe(200);
          const body = JSON.parse(await readableStreamToText(res.body)) as {
            ok: boolean;
            artifacts: Array<{
              gate: string;
              count: number;
              status: string;
              summary: string;
              latestSize?: number;
              latestResultSize?: number;
              latestAgeMs?: number;
              source?: string;
              preview?: string;
            }>;
            probeServerUrl: string;
            probeReachable: boolean;
          };
          expect(body.ok).toBe(true);
          expect(body.artifacts.map((row) => row.gate).sort()).toEqual([
            "bunfig-policy",
            "card-probe",
          ]);
          expect(body.artifacts.find((row) => row.gate === "bunfig-policy")?.status).toBe("pass");
          expect(body.artifacts.find((row) => row.gate === "card-probe")?.summary).toContain(
            "card probe failed"
          );
          expect(typeof body.probeServerUrl).toBe("string");
          expect(body.probeReachable).toBe(false);
          const bunfig = body.artifacts.find((row) => row.gate === "bunfig-policy");
          expect(bunfig?.latestSize).toBeGreaterThan(0);
          expect(bunfig?.latestResultSize).toBeGreaterThan(0);
          expect(bunfig?.latestAgeMs).toBeGreaterThanOrEqual(0);
          expect(bunfig?.source).toBe("artifact-store");
          expect(bunfig?.preview).toContain("bunfig policy ok");
        } finally {
          server.stop();
        }
      });
      cleanupPath(dir);
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server artifacts API filters by sessionId",
    async () => {
      const dir = testTempDir("herdr-dashboard-artifacts-session-");
      const prev = Bun.env.KIMI_CODE_SESSION;
      const store = new ArtifactStore(dir);
      Bun.env.KIMI_CODE_SESSION = "wd_filter_a";
      await store.save("model-drift", { status: "pass", n: 1 });
      Bun.env.KIMI_CODE_SESSION = "wd_filter_b";
      await store.save("model-drift", { status: "warn", n: 2 });

      const server = startHerdrDashboardServer({
        projectPath: dir,
        port: 0,
        sessions: false,
      });
      try {
        const res = (await fetch(
          `${server.url}api/artifacts?sessionId=wd_filter_a`
        )) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        const body = JSON.parse(await readableStreamToText(res.body)) as {
          ok: boolean;
          artifacts: Array<{ gate: string; count: number; sessionId?: string }>;
          filter?: { sessionId?: string };
          filterOptions?: { sessionIds: string[] };
        };
        expect(body.ok).toBe(true);
        expect(body.filter?.sessionId).toBe("wd_filter_a");
        expect(body.artifacts).toHaveLength(1);
        expect(body.artifacts[0]?.gate).toBe("model-drift");
        expect(body.artifacts[0]?.count).toBe(1);
        expect(body.artifacts[0]?.sessionId).toBe("wd_filter_a");
        expect(body.filterOptions?.sessionIds).toContain("wd_filter_a");
        expect(body.filterOptions?.sessionIds).toContain("wd_filter_b");
      } finally {
        server.stop();
        if (prev === undefined) delete Bun.env.KIMI_CODE_SESSION;
        else Bun.env.KIMI_CODE_SESSION = prev;
      }
      cleanupPath(dir);
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server sessions API lists kimi and herdr scopes",
    async () => {
      const dir = testTempDir("herdr-dashboard-sessions-index-");
      const store = new ArtifactStore(dir);
      await store.save(
        "perf-gate",
        { ok: true },
        { sessionId: "wd_index_a", workspaceId: "staging" }
      );
      await store.saveRunManifest({
        schemaVersion: 1,
        runId: "run_index_b",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: ["perf-gate"],
        artifacts: {},
        status: "pass",
        workspaceId: "staging",
      });

      const server = startHerdrDashboardServer({
        projectPath: dir,
        port: 0,
        sessions: true,
      });
      try {
        const res = (await fetch(`${server.url}api/sessions`)) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        const body = JSON.parse(await readableStreamToText(res.body)) as {
          ok: boolean;
          sessions: { kimi: string[]; herdr: string[] };
        };
        expect(body.sessions.kimi).toContain("wd_index_a");
        expect(body.sessions.herdr).toContain("staging");

        const scoped = (await fetch(`${server.url}api/sessions/staging/runs`)) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        const scopedBody = JSON.parse(await readableStreamToText(scoped.body)) as {
          runs: Array<{ runId: string }>;
        };
        expect(scopedBody.runs.map((row) => row.runId)).toEqual(["run_index_b"]);
      } finally {
        server.stop();
      }
      cleanupPath(dir);
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server aggregates API returns per-gate counts",
    async () => {
      const dir = testTempDir("herdr-dashboard-aggregates-");
      const store = new ArtifactStore(dir);
      await store.save("bunfig-policy", { ok: true }, { sessionId: "wd_agg" });
      await store.save("bunfig-policy", { ok: false }, { sessionId: "wd_agg" });
      await store.save("card-probe", { ok: true }, { sessionId: "wd_agg" });

      const server = startHerdrDashboardServer({
        projectPath: dir,
        port: 0,
        sessions: false,
      });
      try {
        const res = (await fetch(`${server.url}api/artifacts/aggregates`)) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        const body = JSON.parse(await readableStreamToText(res.body)) as {
          ok: boolean;
          aggregates: Array<{ gate: string; count: number; latestMs: number }>;
        };
        expect(body.ok).toBe(true);
        expect(body.aggregates).toHaveLength(2);
        expect(body.aggregates.find((row) => row.gate === "bunfig-policy")?.count).toBe(2);
        expect(body.aggregates.find((row) => row.gate === "card-probe")?.count).toBe(1);

        const filtered = (await fetch(
          `${server.url}api/artifacts/aggregates?statuses=fail`
        )) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        const filteredBody = JSON.parse(await readableStreamToText(filtered.body)) as {
          ok: boolean;
          aggregates: Array<{ gate: string; count: number }>;
        };
        expect(filteredBody.aggregates).toHaveLength(1);
        expect(filteredBody.aggregates[0]?.gate).toBe("bunfig-policy");
        expect(filteredBody.aggregates[0]?.count).toBe(1);
      } finally {
        server.stop();
      }
      cleanupPath(dir);
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server index stats and artifact diff APIs",
    async () => {
      const dir = testTempDir("herdr-dashboard-index-diff-");
      const store = new ArtifactStore(dir);
      const pathA = await store.save("model-drift", { ok: true, n: 1 });
      await Bun.sleep(2);
      const pathB = await store.save("model-drift", { ok: true, n: 2 });
      const relA = pathA.slice(dir.length + 1);
      const relB = pathB.slice(dir.length + 1);

      const server = startHerdrDashboardServer({
        projectPath: dir,
        port: 0,
        sessions: false,
      });
      try {
        const statsRes = (await fetch(`${server.url}api/artifacts/index/stats`)) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(statsRes.status).toBe(200);
        const statsBody = JSON.parse(await readableStreamToText(statsRes.body)) as {
          ok: boolean;
          stats: { totalArtifacts: number; fsArtifactCount: number };
        };
        expect(statsBody.ok).toBe(true);
        expect(statsBody.stats.totalArtifacts).toBe(2);
        expect(statsBody.stats.fsArtifactCount).toBe(2);

        const diffRes = (await fetch(
          `${server.url}api/artifacts/model-drift/diff?a=${encodeURIComponent(relA)}&b=${encodeURIComponent(relB)}`
        )) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(diffRes.status).toBe(200);
        const diffBody = JSON.parse(await readableStreamToText(diffRes.body)) as {
          ok: boolean;
          equal: boolean;
          indexSource: string;
        };
        expect(diffBody.ok).toBe(true);
        expect(diffBody.equal).toBe(false);
        expect(diffBody.indexSource).toBe("sqlite");
      } finally {
        server.stop();
      }
      cleanupPath(dir);
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server serves artifact RSS feed",
    async () => {
      const dir = testTempDir("herdr-dashboard-feed-");
      const store = new ArtifactStore(dir);
      await store.save("model-drift", { ok: true, note: "feed-a" });
      await Bun.sleep(2);
      await store.save("bunfig-policy", { ok: false, note: "feed-b" });

      const server = startHerdrDashboardServer({
        projectPath: dir,
        port: 0,
        sessions: false,
      });
      try {
        const res = (await fetch(`${server.url}api/artifacts/feed.xml?limit=5`)) as unknown as {
          status: number;
          headers: Headers;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/rss+xml");
        const xml = await readableStreamToText(res.body);
        expect(xml).toContain('<rss version="2.0">');
        expect(xml).toContain("<item>");
        expect(xml).toContain("model-drift");
        expect(xml).toContain("bunfig-policy");
      } finally {
        server.stop();
      }
      cleanupPath(dir);
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server runs API filters by run identity",
    async () => {
      const dir = testTempDir("herdr-dashboard-runs-");
      const store = new ArtifactStore(dir);
      await store.saveRunManifest({
        schemaVersion: 1,
        runId: "run_dashboard_a",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: ["model-drift"],
        artifacts: { "model-drift": ".kimi/artifacts/model-drift/a.json" },
        status: "pass",
        sessionId: "wd_dashboard_a",
        paneId: "pane_dashboard",
      });
      await store.saveRunManifest({
        schemaVersion: 1,
        runId: "run_dashboard_b",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: ["model-drift"],
        artifacts: { "model-drift": ".kimi/artifacts/model-drift/b.json" },
        status: "warn",
        sessionId: "wd_dashboard_b",
      });

      const server = startHerdrDashboardServer({
        projectPath: dir,
        port: 0,
        sessions: false,
      });
      try {
        const res = (await fetch(`${server.url}api/runs?sessionId=wd_dashboard_a`)) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        const body = JSON.parse(await readableStreamToText(res.body)) as {
          ok: boolean;
          runs: Array<{ runId: string; sessionId?: string; paneId?: string }>;
        };
        expect(body.ok).toBe(true);
        expect(body.runs).toEqual([
          expect.objectContaining({
            runId: "run_dashboard_a",
            sessionId: "wd_dashboard_a",
            paneId: "pane_dashboard",
          }),
        ]);

        const one = (await fetch(`${server.url}api/runs/run_dashboard_a`)) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(one.status).toBe(200);
        const detail = JSON.parse(await readableStreamToText(one.body)) as {
          ok: boolean;
          runId: string;
          manifest: { gates: string[]; status: string; sessionId?: string };
          artifacts: Array<{ gate: string; path: string }>;
        };
        expect(detail.ok).toBe(true);
        expect(detail.runId).toBe("run_dashboard_a");
        expect(detail.manifest.status).toBe("pass");
        expect(detail.manifest.sessionId).toBe("wd_dashboard_a");
        expect(detail.manifest.gates).toEqual(["model-drift"]);
        expect(detail.artifacts).toEqual([
          expect.objectContaining({
            gate: "model-drift",
            path: ".kimi/artifacts/model-drift/a.json",
          }),
        ]);

        const missing = (await fetch(`${server.url}api/runs/run_missing`)) as unknown as {
          status: number;
        };
        expect(missing.status).toBe(404);
      } finally {
        server.stop();
      }
      cleanupPath(dir);
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server run manifest links recorded doctor runs",
    async () => {
      const dir = testTempDir("herdr-dashboard-run-doctor-");
      const home = testTempDir("herdr-dashboard-run-doctor-home-");
      const store = new ArtifactStore(dir);
      await store.saveRunManifest({
        schemaVersion: 1,
        runId: "run_doctor_linked",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: ["bunfig-policy"],
        artifacts: {},
        status: "pass",
        sessionId: "wd_doctor_linked",
      });

      await withEnv({ HOME: home }, async () => {
        recordDoctorRun(
          "kimi-toolchain",
          "kimi-doctor",
          [{ check: "mock-check", message: "mock warning", severity: "warn" }],
          undefined,
          undefined,
          "wd_doctor_linked",
          "run_doctor_linked"
        );

        const server = startHerdrDashboardServer({
          projectPath: dir,
          port: 0,
          sessions: false,
        });
        try {
          const res = (await fetch(`${server.url}api/runs/run_doctor_linked`)) as unknown as {
            status: number;
            body: ReadableStream<Uint8Array>;
          };
          expect(res.status).toBe(200);
          const detail = JSON.parse(await readableStreamToText(res.body)) as {
            ok: boolean;
            runId: string;
            doctorRuns: Array<{ tool: string; runId: string | null; sessionId: string | null }>;
          };
          expect(detail.ok).toBe(true);
          expect(detail.runId).toBe("run_doctor_linked");
          expect(detail.doctorRuns.length).toBeGreaterThanOrEqual(1);
          expect(detail.doctorRuns[0]).toEqual(
            expect.objectContaining({
              tool: "kimi-doctor",
              runId: "run_doctor_linked",
              sessionId: "wd_doctor_linked",
            })
          );
        } finally {
          server.stop();
        }
      });
      cleanupPath(dir);
      cleanupPath(home);
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server lineage API returns Mermaid for artifact dependsOn",
    async () => {
      const dir = testTempDir("herdr-dashboard-lineage-");
      const store = new ArtifactStore(dir);
      await store.save("strategy-performance", { pnl: 1 });
      await store.save(
        "model-drift",
        { drift: 0.2 },
        { dependsOn: [{ gate: "strategy-performance", limit: 1 }] }
      );

      const server = startHerdrDashboardServer({
        projectPath: dir,
        port: 0,
        sessions: false,
      });
      try {
        const lineageRes = (await fetch(
          `${server.url}api/artifacts/model-drift/lineage`
        )) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(lineageRes.status).toBe(200);
        const lineage = JSON.parse(await readableStreamToText(lineageRes.body)) as {
          ok: boolean;
          gate: string;
          mermaid: string;
          dependencyCount: number;
          stored: boolean;
          lineageSource: string;
        };
        expect(lineage.ok).toBe(true);
        expect(lineage.gate).toBe("model-drift");
        expect(lineage.dependencyCount).toBe(1);
        expect(lineage.stored).toBe(true);
        expect(lineage.lineageSource).toBe("stored");
        expect(lineage.mermaid).toContain("strategy-performance");

        const upstreamPath = await store.save("bunfig-policy", { status: "pass" });
        await store.save(
          "perf-gate",
          { status: "pass" },
          {
            lineage: {
              dependencies: ["bunfig-policy"],
              upstreamArtifacts: [store.relativePath(upstreamPath)],
            },
          }
        );
        const runtimeRes = (await fetch(
          `${server.url}api/artifacts/perf-gate/lineage`
        )) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(runtimeRes.status).toBe(200);
        const runtimeLineage = JSON.parse(await readableStreamToText(runtimeRes.body)) as {
          lineageSource: string;
          mermaid: string;
        };
        expect(runtimeLineage.lineageSource).toBe("runtime");
        expect(runtimeLineage.mermaid).toContain("bunfig-policy");

        const graphRes = (await fetch(`${server.url}api/gates/graph`)) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(graphRes.status).toBe(200);
        const graph = JSON.parse(await readableStreamToText(graphRes.body)) as {
          ok: boolean;
          mermaid: string;
          gates: Array<{ name: string }>;
        };
        expect(graph.ok).toBe(true);
        expect(graph.mermaid).toContain("graph TD");
        expect(graph.gates.length).toBeGreaterThan(0);
      } finally {
        server.stop();
      }
      cleanupPath(dir);
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server artifact context API returns metadata graph",
    async () => {
      const dir = testTempDir("herdr-dashboard-context-");
      const store = new ArtifactStore(dir);
      const upstreamPath = await store.save("bunfig-policy", { status: "pass" });
      await store.save(
        "perf-gate",
        { status: "pass" },
        {
          lineage: {
            dependencies: ["bunfig-policy"],
            upstreamArtifacts: [store.relativePath(upstreamPath)],
          },
        }
      );
      await store.save("card-probe", { ok: true });

      const server = startHerdrDashboardServer({
        projectPath: dir,
        port: 0,
        sessions: false,
      });
      try {
        const res = (await fetch(`${server.url}api/artifacts/context`)) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        const body = JSON.parse(await readableStreamToText(res.body)) as {
          ok: boolean;
          total: number;
          gates: number;
          mermaid: string;
          nodes: Array<{
            gate: string;
            status: string;
            upstream: string[];
            hostname?: string;
            pid?: number;
          }>;
          edges: Array<{ from: string; to: string }>;
          probeReachable: boolean;
        };
        expect(body.ok).toBe(true);
        expect(body.total).toBe(3);
        expect(body.gates).toBe(3);
        expect(body.mermaid).toContain("flowchart TD");
        expect(body.mermaid).toContain("bunfig-policy");
        expect(body.mermaid).toContain("perf-gate");
        expect(body.nodes.some((n) => n.gate === "perf-gate" && n.status === "pass")).toBe(true);
        const perfNode = body.nodes.find((n) => n.gate === "perf-gate");
        expect(perfNode?.hostname).toBeTruthy();
        expect(perfNode?.pid).toBe(process.pid);
        expect(body.edges.length).toBe(1);
        expect(typeof body.probeReachable).toBe("boolean");
      } finally {
        server.stop();
      }
      cleanupPath(dir);
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server metadata API returns indexed envelope metadata",
    async () => {
      const dir = testTempDir("herdr-dashboard-metadata-");
      const store = new ArtifactStore(dir);
      await store.save(
        "model-drift",
        { drift: 0.2 },
        {
          dependsOn: [{ gate: "strategy-performance", limit: 1 }],
          runId: "run_herdr_meta",
          level: 2,
        }
      );

      const server = startHerdrDashboardServer({
        projectPath: dir,
        port: 0,
        sessions: false,
      });
      try {
        const res = (await fetch(
          `${server.url}api/artifacts/metadata?gate=model-drift&limit=5`
        )) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        const body = JSON.parse(await readableStreamToText(res.body)) as {
          ok: boolean;
          indexSource: string;
          entries: Array<{
            gate: string;
            metadata: { runId?: string; hostname?: string; pid?: number; dependsOn?: unknown[] };
          }>;
        };
        expect(body.ok).toBe(true);
        expect(body.indexSource).toBe("sqlite");
        expect(body.entries[0]?.gate).toBe("model-drift");
        expect(body.entries[0]?.metadata.runId).toBe("run_herdr_meta");
        expect(body.entries[0]?.metadata.hostname).toBeTruthy();
        expect(body.entries[0]?.metadata.pid).toBe(process.pid);
        expect(body.entries[0]?.metadata.dependsOn?.length).toBe(1);
      } finally {
        server.stop();
      }
      cleanupPath(dir);
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server artifacts API is read-only",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
        herdrEvents: false,
        gateHealthWatch: false,
        metaWatch: false,
      });
      try {
        const res = (await fetch(`${server.url}api/artifacts/bunfig-policy/refresh`, {
          method: "POST",
        })) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(405);
        const body = JSON.parse(await readableStreamToText(res.body)) as {
          ok: boolean;
          error: string;
        };
        expect(body.ok).toBe(false);
        expect(body.error).toContain("artifact API is read-only");
        expect(body.error).toContain("kimi-doctor --gate <name> --save-artifact");
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server artifact APIs reject non-GET methods without running gates",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
      });
      try {
        for (const [method, path] of [
          ["POST", "api/artifacts"],
          ["PUT", "api/artifacts/context"],
          ["DELETE", "api/artifacts/perf-gate/lineage"],
        ] as const) {
          const res = await server.fetch(new Request(`${server.url}${path}`, { method }));
          expect(res.status).toBe(405);
          const body = JSON.parse(await readableStreamToText(res.body!)) as {
            ok: boolean;
            error: string;
          };
          expect(body.ok).toBe(false);
          expect(body.error).toContain("artifact API is read-only");
          expect(body.error).toContain("kimi-doctor --gate <name> --save-artifact");
        }
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard events API filters by type agent severity and query",
    async () => {
      const home = testTempDir("herdr-events-home-");
      const workspace = `events-${Bun.randomUUIDv7()}`;
      try {
        await withEnv({ HOME: home }, async () => {
          makeDir(join(home, ".kimi-code", "var"), { recursive: true });
          const nowNs = Date.now() * 1_000_000;
          writeDashboardEvent({
            type: "gate.failed",
            workspace,
            agent: "codex",
            payload: {
              status: "error",
              gate: "model-drift",
              message: "drift threshold tripped",
            },
            at: nowNs + 1,
          });
          writeDashboardEvent({
            type: "gate.failed",
            workspace,
            agent: "kimi",
            payload: {
              status: "warn",
              gate: "model-drift",
              message: "drift warning only",
            },
            at: nowNs + 2,
          });
          writeDashboardEvent({
            type: "gate.cleared",
            workspace,
            agent: "codex",
            payload: {
              status: "ok",
              gate: "model-drift",
              message: "threshold recovered",
            },
            at: nowNs + 3,
          });

          const server = startHerdrDashboardServer({
            projectPath: REPO_ROOT,
            port: 0,
            sessions: false,
            herdrEvents: false,
            gateHealthWatch: false,
            metaWatch: false,
          });
          try {
            const params = new URLSearchParams({
              type: "gate.failed",
              workspace,
              agent: "codex",
              severity: "error",
              query: "threshold",
              limit: "10",
            });
            const res = await server.fetch(
              new Request(`${server.url}api/events?${params.toString()}`)
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(await readableStreamToText(res.body!)) as {
              ok: boolean;
              count: number;
              events: Array<{
                type: string;
                workspace: string | null;
                agent: string | null;
                severity: string;
                payload: { gate?: string; message?: string };
                payloadKeys: string[];
                tags: string[];
              }>;
              types: string[];
            };
            expect(body.ok).toBe(true);
            expect(body.count).toBe(1);
            expect(body.events).toHaveLength(1);
            expect(body.events[0]?.type).toBe("gate.failed");
            expect(body.events[0]?.workspace).toBe(workspace);
            expect(body.events[0]?.agent).toBe("codex");
            expect(body.events[0]?.severity).toBe("error");
            expect(body.events[0]?.payload.gate).toBe("model-drift");
            expect(body.events[0]?.payload.message).toContain("threshold");
            expect(body.events[0]?.payloadKeys).toContain("message");
            expect(body.events[0]?.tags).toContain("agent:codex");
            expect(body.types).toContain("gate.failed");
            expect(body.types).toContain("gate.cleared");
          } finally {
            server.stop();
          }
        });
      } finally {
        cleanupPath(home);
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard debug logs API returns entries alongside lines",
    async () => {
      const home = testTempDir("herdr-debug-logs-home-");
      try {
        await withEnv({ HOME: home }, async () => {
          makeDir(join(home, ".kimi-code", "var"), { recursive: true });
          writeText(
            failureLedgerPath(),
            ["first info line", "second warning line", "third fatal error line"].join("\n")
          );

          const server = startHerdrDashboardServer({
            projectPath: REPO_ROOT,
            port: 0,
            sessions: false,
            herdrEvents: false,
            gateHealthWatch: false,
            metaWatch: false,
          });
          try {
            const res = await server.fetch(
              new Request(`${server.url}api/debug/logs?sink=tool-failures&tail=2`)
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(await readableStreamToText(res.body!)) as {
              ok: boolean;
              sink: string;
              lines: string[];
              entries: Array<{
                lineNumber: number;
                severity: string;
                message: string;
                preview: string;
                raw: string;
                source: string;
                tags: string[];
                payloadKeys: string[];
              }>;
              totalLines: number;
              tail: number;
            };
            expect(body.ok).toBe(true);
            expect(body.sink).toBe("tool-failures");
            expect(body.lines).toEqual(["second warning line", "third fatal error line"]);
            expect(body.entries).toHaveLength(body.lines.length);
            expect(body.entries[0]).toEqual({
              lineNumber: 2,
              severity: "warn",
              message: "second warning line",
              preview: "second warning line",
              raw: "second warning line",
              source: "tool-failures",
              tags: ["sink:tool-failures", "severity:warn"],
              payloadKeys: [],
            });
            expect(body.entries[1]).toEqual({
              lineNumber: 3,
              severity: "error",
              message: "third fatal error line",
              preview: "third fatal error line",
              raw: "third fatal error line",
              source: "tool-failures",
              tags: ["sink:tool-failures", "severity:error"],
              payloadKeys: [],
            });
            expect(body.totalLines).toBe(3);
            expect(body.tail).toBe(2);
          } finally {
            server.stop();
          }
        });
      } finally {
        cleanupPath(home);
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server examples health API reports unavailable service",
    async () => {
      await withEnv({ HERDR_EXAMPLES_DASHBOARD_URL: "http://127.0.0.1:9/" }, async () => {
        const server = startHerdrDashboardServer({
          projectPath: REPO_ROOT,
          port: 0,
          sessions: false,
          herdrEvents: false,
          gateHealthWatch: false,
        });
        try {
          const res = (await fetch(`${server.url}api/examples/health`)) as unknown as {
            status: number;
            body: ReadableStream<Uint8Array>;
          };
          expect(res.status).toBe(200);
          const body = JSON.parse(await readableStreamToText(res.body)) as {
            ok: boolean;
            url: string;
            healthUrl: string;
            error?: string;
          };
          expect(body.ok).toBe(false);
          expect(body.url).toBe("http://127.0.0.1:9/");
          expect(body.healthUrl).toBe("http://127.0.0.1:9/health");
          expect(body.error).toBeTruthy();
        } finally {
          server.stop();
        }
      });
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server health API returns subsystem statuses",
    async () => {
      const discoveryCache = new HerdrDashboardDiscoveryCache({
        projectPath: REPO_ROOT,
        fetchOpts: { sessions: false },
        ttlMs: 60_000,
        discover: async () => ({
          ok: true,
          projectPath: REPO_ROOT,
          agentCount: 2,
          agents: [
            {
              agent: "kimi",
              host: "local",
              session: "",
              workspaceId: "w1",
              status: "idle",
              paneId: "1-1",
              source: "local",
            },
            {
              agent: "kimi",
              host: "local",
              session: "",
              workspaceId: "w1",
              status: "working",
              paneId: "1-2",
              source: "local",
            },
          ],
          fetchedAt: new Date().toISOString(),
        }),
        probeRemoteHosts: async () => ({
          configured: 0,
          reachable: 0,
          hosts: [],
        }),
      });
      await withEnv({ PROBE_SERVER_PORT: "59124" }, async () => {
        const server = startHerdrDashboardServer({
          projectPath: REPO_ROOT,
          port: 0,
          sessions: false,
          discoveryCache,
          herdrEvents: false,
          gateHealthWatch: false,
        });
        try {
          await server.hub.refresh();
          const res = (await fetch(`${server.url}api/health`)) as unknown as {
            status: number;
            body: ReadableStream<Uint8Array>;
          };
          expect(res.status).toBe(200);
          const body = JSON.parse(await readableStreamToText(res.body)) as {
            ok: boolean;
            checks: {
              agents: { status: string; count: number };
              sse: { status: string; subscribers: number };
              herdr: { status: string; connected: boolean; workspaceId: string | null };
              gate: { status: string; failed: boolean | null };
              probe: {
                status: string;
                reachable: boolean;
                pass: number;
                fail: number;
                skip: number;
                url: string;
              };
              discovery: { status: string; workspaceId: string | null };
            };
            fetchedAt: string;
          };
          expect(body.ok).toBe(true);
          expect(body.checks.agents.status).toBe("ok");
          expect(body.checks.agents.count).toBe(2);
          expect(body.checks.sse.status).toBe("warn");
          expect(["ok", "warn", "unknown"]).toContain(body.checks.herdr.status);
          expect(
            body.checks.gate.failed === null || typeof body.checks.gate.failed === "boolean"
          ).toBe(true);
          expect(body.checks.discovery.status).toBe("ok");
          expect(body.checks.probe.status).toBe("unknown");
          expect(body.checks.probe.reachable).toBe(false);
          expect(body.fetchedAt).toBeTruthy();
        } finally {
          server.stop();
        }
      });
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server proxies serve-probe when [doctor.probe] port is reachable",
    async () => {
      const dir = testTempDir("herdr-dashboard-probe-proxy-");
      const probe = await startProbeServer({
        port: 0,
        projectRoot: dir,
        probeConfig: { timeoutMs: 100 },
      });
      try {
        await Bun.write(
          join(dir, "dx.config.toml"),
          `[doctor.probe]\nport = ${new URL(probe.url).port}\nhost = "127.0.0.1"\n`
        );
        const dashboard = startHerdrDashboardServer({
          projectPath: dir,
          port: 0,
          sessions: false,
        });
        try {
          const healthRes = (await fetch(`${dashboard.url}api/health`)) as unknown as {
            status: number;
            body: ReadableStream<Uint8Array>;
          };
          const health = JSON.parse(await readableStreamToText(healthRes.body)) as {
            checks: { probe: { reachable: boolean; status: string } };
          };
          expect(health.checks.probe.reachable).toBe(true);
          expect(["ok", "warn", "error"]).toContain(health.checks.probe.status);

          const cardsRes = (await fetch(`${dashboard.url}api/probe/cards`)) as unknown as {
            status: number;
            body: ReadableStream<Uint8Array>;
          };
          expect(cardsRes.status).toBe(200);
          const cards = JSON.parse(await readableStreamToText(cardsRes.body)) as {
            ok: boolean;
            reachable: boolean;
            summary: { total: number };
          };
          expect(cards.reachable).toBe(true);
          expect(cards.summary.total).toBeGreaterThanOrEqual(0);
        } finally {
          dashboard.stop();
        }
      } finally {
        probe.stop();
        cleanupPath(dir);
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server processes widget returns 200 with session context",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
        widgetProcessesDeps: {
          listLocalPanes: () => ({
            ok: true,
            panes: [
              {
                paneId: "1-1",
                tabId: "1-1",
                workspaceId: "wB",
                focused: true,
                agent: "kimi",
                agentStatus: "working",
                title: "main",
                cwd: REPO_ROOT,
                isShell: false,
              },
            ],
          }),
        },
      });
      try {
        const res = (await fetch(`${server.url}api/widgets/processes`)) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        const body = JSON.parse(await readableStreamToText(res.body)) as {
          widget: string;
          available: boolean;
          data?: { paneCount: number };
        };
        expect(body.widget).toBe("processes");
        expect(body.available).toBe(true);
        expect(body.data?.paneCount).toBe(1);
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server logs widget returns 200 with pane scrollback",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
        widgetLogsDeps: {
          readLocalPane: () => ({ ok: true, text: "alpha\nbeta\n" }),
        },
      });
      try {
        const res = (await fetch(`${server.url}api/widgets/logs?paneId=1-1`)) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        const body = JSON.parse(await readableStreamToText(res.body)) as {
          widget: string;
          ok: boolean;
          available: boolean;
          paneId: string;
          lines?: string[];
        };
        expect(body.widget).toBe("logs");
        expect(body.ok).toBe(true);
        expect(body.available).toBe(true);
        expect(body.paneId).toBe("1-1");
        expect(body.lines).toEqual(["alpha", "beta", ""]);
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server logs widget returns 200 when paneId missing",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
      });
      try {
        const res = (await fetch(`${server.url}api/widgets/logs`)) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        const body = JSON.parse(await readableStreamToText(res.body)) as {
          widget: string;
          session: string;
          sessionLabel: string;
          available: boolean;
          error?: string;
        };
        expect(body.widget).toBe("logs");
        expect(body.session).toBe("");
        expect(body.sessionLabel).toBe("primary");
        expect(body.available).toBe(false);
        expect(body.error).toBe("paneId required");
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server processes action POST runs pane focus",
    async () => {
      let actionCalls = 0;
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
        widgetProcessesActionDeps: {
          runLocalPaneAction: (_session, paneId, action) => {
            actionCalls += 1;
            expect(paneId).toBe("1-1");
            expect(action).toBe("focus");
            return { ok: true };
          },
        },
      });
      try {
        const res = (await fetch(`${server.url}api/widgets/processes/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paneId: "1-1", action: "focus" }),
        })) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        const body = JSON.parse(await readableStreamToText(res.body)) as {
          ok: boolean;
          action: string;
          paneId: string;
          message: string;
        };
        expect(body.ok).toBe(true);
        expect(body.action).toBe("focus");
        expect(body.message).toContain("focused pane 1-1");
        expect(actionCalls).toBe(1);
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server processes action POST validates body",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
      });
      try {
        const res = (await fetch(`${server.url}api/widgets/processes/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "focus" }),
        })) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(400);
        const body = JSON.parse(await readableStreamToText(res.body)) as { error: string };
        expect(body.error).toContain("paneId and action required");
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server git widget returns 200 with session context",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
        widgetGitDeps: {
          readLocalGit: async () => ({
            ok: true,
            data: {
              branch: "main",
              dirty: true,
              changedCount: 1,
              status: [{ xy: " M", path: "README.md" }],
              commits: [{ sha: "deadbeef", subject: "docs", date: "2026-06-18T00:00:00+00:00" }],
              commitLimit: 10,
            },
          }),
        },
      });
      try {
        const res = (await fetch(`${server.url}api/widgets/git`)) as unknown as {
          status: number;
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        const body = JSON.parse(await readableStreamToText(res.body)) as {
          widget: string;
          ok: boolean;
          session: string;
          sessionLabel: string;
          available: boolean;
          data?: { branch: string; changedCount: number };
        };
        expect(body.widget).toBe("git");
        expect(body.ok).toBe(true);
        expect(body.session).toBe("");
        expect(body.sessionLabel).toBe("primary");
        expect(body.available).toBe(true);
        expect(body.data?.branch).toBe("main");
        expect(body.data?.changedCount).toBe(1);
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server unknown widget returns 404",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
      });
      try {
        const unknown = (await fetch(`${server.url}api/widgets/metrics`)) as unknown as {
          status: number;
        };
        expect(unknown.status).toBe(404);
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server meta includes webview profile when configured",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        webview: { shell: "webview", persistProfile: true, backend: "webkit" },
      });
      try {
        const metaRes = (await fetch(`${server.url}api/meta`)) as unknown as {
          body: ReadableStream<Uint8Array>;
        };
        const meta = JSON.parse(await readableStreamToText(metaRes.body)) as {
          webview: {
            shell: string;
            persistProfile: boolean;
            mode: string;
            directory?: string;
          };
        };
        expect(meta.webview.shell).toBe("webview");
        if (bunImageSupported()) {
          expect((meta as { thumbnail?: boolean }).thumbnail).toBe(true);
        }
        expect(meta.webview.persistProfile).toBe(true);
        if (meta.webview.mode === "persistent") {
          expect(meta.webview.directory).toContain("herdr-orchestrator-dashboard-webview");
        }
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server splits ssePollMs from pollHintMs",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        pollHintMs: 12_000,
        ssePollMs: 3_000,
        autoRefresh: false,
        gateHealthWatch: false,
        herdrEvents: false,
      });
      try {
        const metaRes = (await fetch(`${server.url}api/meta`)) as unknown as {
          body: ReadableStream<Uint8Array>;
        };
        const meta = JSON.parse(await readableStreamToText(metaRes.body)) as {
          pollHintMs: number;
          ssePollMs: number;
        };
        expect(meta.pollHintMs).toBe(12_000);
        expect(meta.ssePollMs).toBe(3_000);
        expect((server.hub as unknown as { pollMs: number }).pollMs).toBe(3_000);
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server accepts batch heartbeats",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
      });
      try {
        const res = await fetchJsonBody<{ ok: boolean; recorded: number }>(
          `${server.url}api/heartbeats`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              agents: [
                { agent: "kimi", host: "(local)", session: "work" },
                { agent: "codex", host: "(local)", session: "work" },
              ],
            }),
          }
        );
        expect(res.status).toBe(200);
        expect(res.data.ok).toBe(true);
        expect(res.data.recorded).toBe(2);
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server exposes SSE agents live stream",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
      });
      try {
        const res = (await fetch(`${server.url}api/agents/live`)) as unknown as {
          headers: { get(name: string): string | null };
          body: ReadableStream<Uint8Array>;
        };
        expect(res.headers.get("content-type")).toContain("text/event-stream");
        const reader = res.body.getReader();
        const read = await reader.read();
        await reader.cancel();
        if (read.value) {
          expect(new TextDecoder().decode(read.value)).toContain("data:");
        }
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test("runDashboardIpcCommand maps agent.restart", async () => {
    const result = await runDashboardIpcCommand(REPO_ROOT, {
      command: "agent.restart",
      args: { agent: "kimi", host: "remote", session: "work" },
    });
    expect(result.command).toBe("agent.restart");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("herdr-orchestrator");
  });

  test("runDashboardIpcCommand scan.run returns upgrade-advisor report", async () => {
    const dir = testTempDir("herdr-scan-ipc-");
    writeText(join(dir, "package.json"), JSON.stringify({ name: "scan-ipc" }, null, 2));
    const result = await runDashboardIpcCommand(dir, { command: "scan.run" });
    expect(result.command).toBe("scan.run");
    expect(result.ok).toBe(true);
    expect(result.scan?.schemaVersion).toBe(1);
    expect(result.scan?.tool).toBe("upgrade-advisor");
    expect(Array.isArray(result.scan?.findings)).toBe(true);
  });

  test("GET /api/scan returns upgrade-advisor JSON", async () => {
    const dir = testTempDir("herdr-scan-api-");
    writeText(join(dir, "package.json"), JSON.stringify({ name: "scan-api" }, null, 2));
    const server = startHerdrDashboardServer({
      projectPath: dir,
      port: 0,
      sessions: false,
    });
    try {
      const res = (await fetch(`${server.url}api/scan`)) as unknown as {
        body: ReadableStream<Uint8Array>;
      };
      const raw = await readableStreamToText(res.body);
      const payload = JSON.parse(raw) as {
        ok: boolean;
        report: { tool: string; findings: unknown[] };
      };
      expect(payload.ok).toBe(true);
      expect(payload.report.tool).toBe("upgrade-advisor");
      expect(Array.isArray(payload.report.findings)).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("createDashboardWebViewConsole intercepts IPC tag", () => {
    const received: DashboardIpcCommand[] = [];
    const handler = createDashboardWebViewConsole((cmd) => received.push(cmd));
    handler("log", IPC_CONSOLE_TAG, {
      command: "agent.stop",
      args: { agent: "kimi" },
    });
    expect(received).toHaveLength(1);
    expect(received[0]?.command).toBe("agent.stop");
    expect(received[0]?.args).toEqual({ agent: "kimi" });
  });

  test("createDashboardWebViewConsole mirrors non-IPC logs to globalThis.console", async () => {
    const handler = createDashboardWebViewConsole();
    const lines = await captureConsole(() => {
      handler("log", "dashboard.agents", 3);
    });
    expect(lines.join(" ")).toContain("dashboard.agents");
    expect(lines.join(" ")).toContain("3");
  });

  test("buildDashboardWebViewOptions mirrors page console via globalThis.console by default", async () => {
    const built = buildDashboardWebViewOptions("http://127.0.0.1:18412/");
    expect(typeof built.constructorOptions.console).toBe("function");
    // The dashboard wraps the mirror so it can intercept open-canvas IPC logs.
    expect(built.constructorOptions.console).not.toBe(webViewConsoleMirror());

    const handler = resolveDashboardWebViewConsole({});
    expect(typeof handler).toBe("function");
    const lines = await captureConsole(() => {
      handler("log", "dashboard.test", 42);
    });
    expect(lines.join(" ")).toContain("dashboard.test");
    expect(lines.join(" ")).toContain("42");
  });

  test("buildDashboardWebViewOptions uses custom handler when onIpc is set", () => {
    const built = buildDashboardWebViewOptions("http://127.0.0.1:18412/", {
      onIpc: () => {},
    });
    expect(typeof built.constructorOptions.console).toBe("function");
    expect(built.constructorOptions.console).not.toBe(globalThis.console);
  });

  test("resolveHerdrDashboardHtmlPath finds synced or repo template", () => {
    const path = resolveHerdrDashboardHtmlPath();
    expect(path).toContain("herdr-dashboard.html");
    expect(pathExists(path)).toBe(true);
  });

  test(
    "dashboard server serves WebP thumbnail from cached PNG",
    async () => {
      if (!bunImageSupported()) return;

      const tinyPng = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        ),
        (c) => c.charCodeAt(0)
      );
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
      });
      try {
        server.setScreenshotPng(tinyPng);
        const res = (await fetch(`${server.url}api/thumbnail`)) as unknown as {
          status: number;
          headers: { get(name: string): string | null };
          body: ReadableStream<Uint8Array>;
        };
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/webp");
        const bytes = new Uint8Array(await Bun.readableStreamToArrayBuffer(res.body));
        expect(bytes.byteLength).toBeGreaterThan(10);
        expect(bytes[0]).toBe(0x52);
        expect(bytes[1]).toBe(0x49);
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboard server negotiates AVIF thumbnail from Accept header",
    async () => {
      if (!bunImageSupported()) return;
      const { probeBunImageAvifEncode } = await import("../src/lib/bun-image.ts");
      if (!(await probeBunImageAvifEncode())) return;

      const tinyPng = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        ),
        (c) => c.charCodeAt(0)
      );
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
      });
      try {
        server.setScreenshotPng(tinyPng);
        const res = (await fetch(`${server.url}api/thumbnail`, {
          headers: { accept: "image/avif,image/webp,*/*" },
        })) as unknown as {
          status: number;
          headers: { get(name: string): string | null };
        };
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/avif");
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );

  test(
    "dashboardScreenshotPlaceholder returns data URL for PNG bytes",
    async () => {
      if (!bunImageSupported()) return;

      const tinyPng = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        ),
        (c) => c.charCodeAt(0)
      );
      const placeholder = await dashboardScreenshotPlaceholder(tinyPng);
      expect(placeholder).toStartWith("data:image/");
    },
    { timeout: SERVER_TEST_MS }
  );

  test("wireAgentThumbnail cache-busts thumbnail URL on meta refresh", () => {
    const js = readText(join(REPO_ROOT, "templates/herdr-dashboard.js"));
    expect(js).toContain("function wireAgentThumbnail");
    expect(js).toContain("function wireSessionBunMark");
    expect(js).toContain("&t=${Date.now()}");
    expect(js).toContain("let thumbLive = false");
    expect(js).toContain("if (thumbLive)");
    expect(js).toMatch(/thumbLive = false[\s\S]*wrap\?\.classList\.remove\("visible"\)/);
  });

  test("herdr-dashboard.js wires canvas deep-link filter via /api/canvas-filter", () => {
    const js = readText(join(REPO_ROOT, "templates/herdr-dashboard.js"));
    expect(js).toContain("function fetchAndApplyCanvasDeepLink");
    expect(js).toContain("function wireCanvasDeepLink");
    expect(js).toContain("/api/canvas-filter");
    expect(js).toContain('addEventListener("popstate"');
    expect(js).toContain("canvas-filter-applied");
  });

  test("herdr-dashboard.js builds run-aware canvas companion deep links", () => {
    const js = readText(join(REPO_ROOT, "templates/herdr-dashboard.js"));
    expect(js).toContain("function canvasCompanionQueryParams");
    expect(js).toContain("function canvasExamplesDeepLink");
    expect(js).toContain("artifactsRunFilter");
    expect(js).toContain("artifactsSessionFilter");
    expect(js).toContain('runId: artifactsRunFilter || ""');
    expect(js).toContain("/api/canvases?");
    expect(js).toContain("canvasExamplesDeepLink(c.dashboardDeepLink, artifactsRunFilter)");
  });

  test(
    "dashboard meta includes placeholder when screenshot cached",
    async () => {
      if (!bunImageSupported()) return;

      const tinyPng = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        ),
        (c) => c.charCodeAt(0)
      );
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
      });
      try {
        server.setScreenshotPng(tinyPng);
        const metaRes = (await fetch(`${server.url}api/meta`)) as unknown as {
          body: ReadableStream<Uint8Array>;
        };
        const meta = JSON.parse(await readableStreamToText(metaRes.body)) as {
          placeholder?: string;
        };
        expect(meta.placeholder).toStartWith("data:image/");
      } finally {
        server.stop();
      }
    },
    { timeout: SERVER_TEST_MS }
  );
});
