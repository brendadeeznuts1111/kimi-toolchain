import { describe, expect, test } from "bun:test";
import { join } from "path";
import { pathExists, readText } from "../src/lib/bun-io.ts";
import { fetchJsonBody, readableStreamToText } from "../src/lib/bun-utils.ts";
import {
  DEFAULT_DASHBOARD_PORT,
  fetchDashboardRules,
  runDashboardAgentAction,
  runDashboardIpcCommand,
} from "../src/lib/herdr-dashboard-data.ts";
import { bunImageSupported } from "../src/lib/bun-image.ts";
import { HerdrDashboardDiscoveryCache } from "../src/lib/herdr-dashboard-discovery-cache.ts";
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
import { REPO_ROOT, captureConsole } from "./helpers.ts";

/** Fast gate: CLI --timeout 1500; slow tests need per-test override. */
const SERVER_TEST_MS = 3000;

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
        };
        const html = await readableStreamToText(htmlRes.body);
        expect(html).toContain("Herdr Orchestrator Dashboard");
        expect(html).toContain("/herdr-dashboard.css");
        expect(html).toContain("/herdr-dashboard.js");
        expect(html).toContain("Loading agents");
        expect(html).toContain("rules-meta-slot");
        expect(html).toContain("control-plane");
        expect(html).toContain("session-scope");
        expect(html).toContain("agents-heading");
        expect(html).toContain("agents-legend");

        const cssRes = (await fetch(`${server.url}herdr-dashboard.css`)) as unknown as {
          body: ReadableStream<Uint8Array>;
        };
        const css = await readableStreamToText(cssRes.body);
        expect(css).toContain(":root");
        await server.hub.refresh();
        const metaRes = (await fetch(`${server.url}api/meta`)) as unknown as {
          body: ReadableStream<Uint8Array>;
        };
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
      } finally {
        server.stop();
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

  test("runDashboardIpcCommand maps agent.restart", () => {
    const result = runDashboardIpcCommand(REPO_ROOT, {
      command: "agent.restart",
      args: { agent: "kimi", host: "remote", session: "work" },
    });
    expect(result.command).toBe("agent.restart");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("herdr-orchestrator");
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

  test("buildDashboardWebViewOptions mirrors page console via globalThis.console by default", () => {
    const built = buildDashboardWebViewOptions("http://127.0.0.1:18412/");
    expect(built.constructorOptions.console).toBe(webViewConsoleMirror());
    expect(resolveDashboardWebViewConsole({})).toBe(globalThis.console);
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
