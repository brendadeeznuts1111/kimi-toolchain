import { describe, expect, test } from "bun:test";
import { pathExists } from "../src/lib/bun-io.ts";
import { readableStreamToText } from "../src/lib/bun-utils.ts";
import {
  DEFAULT_DASHBOARD_PORT,
  fetchDashboardRules,
  runDashboardAgentAction,
  runDashboardIpcCommand,
} from "../src/lib/herdr-dashboard-data.ts";
import { bunImageSupported } from "../src/lib/bun-image.ts";
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

  test("dashboard server serves HTML and meta API", async () => {
    const server = startHerdrDashboardServer({
      projectPath: REPO_ROOT,
      port: 0,
      sessions: false,
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

      const cssRes = (await fetch(`${server.url}herdr-dashboard.css`)) as unknown as {
        body: ReadableStream<Uint8Array>;
      };
      const css = await readableStreamToText(cssRes.body);
      expect(css).toContain(":root");
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
      expect(meta.sse).toBe(true);
      if (bunImageSupported()) {
        expect(meta.thumbnail).toBe(true);
        expect(meta.thumbnailPath).toBe("/api/thumbnail");
      }
    } finally {
      server.stop();
    }
  });

  test("dashboard server splits ssePollMs from pollHintMs", async () => {
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
  });

  test("dashboard server accepts batch heartbeats", async () => {
    const server = startHerdrDashboardServer({
      projectPath: REPO_ROOT,
      port: 0,
    });
    try {
      const res = await fetch(`${server.url}api/heartbeats`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agents: [
            { agent: "kimi", host: "(local)", session: "work" },
            { agent: "codex", host: "(local)", session: "work" },
          ],
        }),
      });
      const body = (await res.json()) as { ok: boolean; recorded: number };
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.recorded).toBe(2);
    } finally {
      server.stop();
    }
  });

  test("dashboard server exposes SSE agents live stream", async () => {
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
  });

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

  test("dashboard server serves WebP thumbnail from cached PNG", async () => {
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
  });

  test("dashboardScreenshotPlaceholder returns data URL for PNG bytes", async () => {
    if (!bunImageSupported()) return;

    const tinyPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      ),
      (c) => c.charCodeAt(0)
    );
    const placeholder = await dashboardScreenshotPlaceholder(tinyPng);
    expect(placeholder).toStartWith("data:image/");
  });

  test("dashboard meta includes placeholder when screenshot cached", async () => {
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
  });
});
