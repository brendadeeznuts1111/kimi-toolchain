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
  DashboardConsole,
  createDashboardConsoleMirror,
} from "../src/lib/herdr-webview-dashboard.ts";
import type { DashboardIpcCommand } from "../src/lib/herdr-dashboard-data.ts";
import { REPO_ROOT } from "./helpers.ts";

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
      const metaRes = (await fetch(`${server.url}api/meta`)) as unknown as {
        body: ReadableStream<Uint8Array>;
      };
      const metaRaw = await readableStreamToText(metaRes.body);
      const meta = JSON.parse(metaRaw) as {
        ok: boolean;
        projectPath: string;
        pollHintMs: number;
        sse?: boolean;
        thumbnail?: boolean;
        thumbnailPath?: string;
      };
      expect(meta.ok).toBe(true);
      expect(meta.projectPath).toBe(REPO_ROOT);
      expect(meta.pollHintMs).toBe(5000);
      expect(meta.sse).toBe(true);
      if (bunImageSupported()) {
        expect(meta.thumbnail).toBe(true);
        expect(meta.thumbnailPath).toBe("/api/thumbnail");
      }
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

  test("DashboardConsole webViewHandler intercepts IPC tag", () => {
    const received: DashboardIpcCommand[] = [];
    const c = new DashboardConsole();
    c.webViewHandler((cmd) => received.push(cmd))("log", "__HERDR_IPC__", {
      command: "agent.stop",
      args: { agent: "kimi" },
    });
    expect(received).toHaveLength(1);
    expect(received[0]?.command).toBe("agent.stop");
    expect(received[0]?.args).toEqual({ agent: "kimi" });
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
