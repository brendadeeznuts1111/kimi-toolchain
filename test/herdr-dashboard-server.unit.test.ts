import { describe, expect, test } from "bun:test";
import { join } from "path";
import { pathExists, readText } from "../src/lib/bun-io.ts";
import { fetchJsonBody, readableStreamToText } from "../src/lib/bun-utils.ts";
import {
  DEFAULT_DASHBOARD_PORT,
  fetchDashboardRules,
  fetchDashboardCanvases,
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
import {
  REPO_ROOT,
  captureConsole,
  cleanupPath,
  testTempDir,
  withEnv,
  writeText,
} from "./helpers.ts";

/** Fast gate: CLI --timeout 1500; slow tests need per-test override. */
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

  test("fetchDashboardCanvases returns all 10 cursorCanvas entries", () => {
    const payload = fetchDashboardCanvases();
    expect(payload.ok).toBe(true);
    expect(payload.canvases.length).toBe(10);

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
  });

  test("fetchDashboardCanvases sorts by readOrder ascending", () => {
    const payload = fetchDashboardCanvases();
    const orders = payload.canvases.map((c) => c.readOrder ?? 99);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
    }
    // Hub (readOrder 1) must be first
    expect(payload.canvases[0].id).toBe("unified");
  });

  test("fetchDashboardCanvases entries have required metadata", () => {
    const payload = fetchDashboardCanvases();
    for (const c of payload.canvases) {
      expect(c.id).toBeTruthy();
      expect(c.canvasId).toBeTruthy();
      expect(c.page).toBeTruthy();
      expect(c.path).toMatch(/^docs\/canvases\/.+\.canvas\.tsx$/);
      expect(c.purpose).toBeTruthy();
    }
  });

  test("fetchDashboardCanvases code-references has optional metadata", () => {
    const payload = fetchDashboardCanvases();
    const entry = payload.canvases.find((c) => c.id === "code-references");
    expect(entry).toBeTruthy();
    expect(entry!.version).toBe("0.1.0");
    expect(entry!.layer).toBe("Doc URL lint");
    expect(entry!.openWhen).toContain("@see ladder");
    expect(entry!.readOrder).toBe(4);
  });

  test("fetchDashboardCanvases herdr-plugin-architecture has version 0.5.0", () => {
    const payload = fetchDashboardCanvases();
    const entry = payload.canvases.find((c) => c.id === "herdr-plugin-architecture");
    expect(entry).toBeTruthy();
    expect(entry!.version).toBe("0.5.0");
    expect(entry!.layer).toBe("Herdr plugins v0.5.0");
    expect(entry!.readOrder).toBe(8);
  });

  test("fetchDashboardCanvases exposes canvasInfluences as influences", () => {
    const payload = fetchDashboardCanvases();
    const deepQuality = payload.canvases.find((c) => c.id === "deep-quality");
    expect(deepQuality?.influences).toContain("card-gates");
    const templates = payload.canvases.find((c) => c.id === "templates");
    expect(templates?.influences).toContain("card-scaffold");
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
        discoveryCache,
      });
      try {
        const htmlRes = (await fetch(server.url)) as unknown as {
          body: ReadableStream<Uint8Array>;
          headers: { get(name: string): string | null };
        };
        const html = await readableStreamToText(htmlRes.body);
        expect(html).toContain("Herdr Orchestrator Dashboard");
        expect(html).toContain('href="herdr-dashboard.css"');
        expect(html).toContain('src="herdr-dashboard.js"');
        expect(html).toContain("Loading agents");
        expect(html).toContain("rules-meta-slot");
        expect(html).toContain("control-plane");
        expect(html).toContain("session-scope");
        expect(html).toContain("agents-heading");
        expect(html).toContain("agents-legend");
        expect(html).toContain("Upgrade scan");
        expect(html).toContain("Artifacts");
        expect(htmlRes.headers.get("access-control-allow-origin")).toBe("*");

        const cssRes = (await fetch(`${server.url}herdr-dashboard.css`)) as unknown as {
          body: ReadableStream<Uint8Array>;
        };
        const css = await readableStreamToText(cssRes.body);
        expect(css).toContain(":root");
        const jsRes = (await fetch(`${server.url}herdr-dashboard.js`)) as unknown as {
          body: ReadableStream<Uint8Array>;
        };
        const js = await readableStreamToText(jsRes.body);
        expect(js).toContain("STATIC_API_ORIGIN");
        expect(js).toContain("apiUrl");
        await server.hub.refresh();
        const metaRes = (await fetch(`${server.url}api/meta`)) as unknown as {
          body: ReadableStream<Uint8Array>;
          headers: { get(name: string): string | null };
        };
        expect(metaRes.headers.get("access-control-allow-origin")).toBe("*");
        const metaRaw = await readableStreamToText(metaRes.body);
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
        } finally {
          server.stop();
        }
      });
      cleanupPath(dir);
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
    "dashboard server artifacts API is read-only",
    async () => {
      const server = startHerdrDashboardServer({
        projectPath: REPO_ROOT,
        port: 0,
        sessions: false,
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
                unknown: number;
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
    expect(js).toContain("&t=${Date.now()}");
    expect(js).toContain("let thumbLive = false");
    expect(js).toContain("if (thumbLive)");
    expect(js).toMatch(/thumbLive = false[\s\S]*wrap\.classList\.remove\("visible"\)/);
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
