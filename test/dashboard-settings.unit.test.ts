import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  CANONICAL_DASHBOARD_PORT,
  parseDashboardCliPort,
  readDashboardConfig,
  resolveDashboardListenPort,
  resolveDashboardProbeBind,
  resolveDashboardSettings,
  resolveDashboardStartupPort,
} from "../src/lib/dashboard-settings.ts";
import { REPO_ROOT, withTempDir } from "./helpers.ts";

describe("dashboard-settings", () => {
  test("resolveDashboardListenPort prefers request URL port", () => {
    const url = new URL("http://127.0.0.1:5678/");
    expect(resolveDashboardListenPort({ requestUrl: url }).port).toBe(5678);
    expect(resolveDashboardListenPort({ requestUrl: url }).source).toBe("request");
  });

  test("resolveDashboardListenPort falls back to canonical 5678", () => {
    const prev = Bun.env.PORT;
    delete Bun.env.PORT;
    try {
      const resolved = resolveDashboardListenPort();
      expect(resolved.port).toBe(CANONICAL_DASHBOARD_PORT);
      expect(resolved.source).toBe("canonical");
    } finally {
      if (prev === undefined) delete Bun.env.PORT;
      else Bun.env.PORT = prev;
    }
  });

  test("resolveDashboardProbeBind uses dx.config port then dashboard port", async () => {
    await withTempDir("dashboard-settings-probe-", async (dir) => {
      await Bun.write(
        join(dir, "dx.config.toml"),
        `[doctor.probe]
port = 5678
host = "127.0.0.1"
`
      );
      const prev = Bun.env.PROBE_SERVER_PORT;
      delete Bun.env.PROBE_SERVER_PORT;
      try {
        const bind = await resolveDashboardProbeBind(dir, 3000);
        expect(bind.port).toBe(5678);
        expect(bind.sources.port).toBe("dx.config");
      } finally {
        if (prev === undefined) delete Bun.env.PROBE_SERVER_PORT;
        else Bun.env.PROBE_SERVER_PORT = prev;
      }
    });
  });

  test("resolveDashboardListenPort uses CLI then dx.config then canonical", async () => {
    const prev = Bun.env.PORT;
    delete Bun.env.PORT;
    try {
      expect(resolveDashboardListenPort({ cliPort: 9001 }).port).toBe(9001);
      expect(resolveDashboardListenPort({ cliPort: 9001 }).source).toBe("cli");

      await withTempDir("dashboard-settings-port-", async (dir) => {
        await Bun.write(
          join(dir, "dx.config.toml"),
          `[dashboard]
port = 7777
`
        );
        const config = await readDashboardConfig(dir);
        expect(config.port).toBe(7777);
        const startup = await resolveDashboardStartupPort(dir);
        expect(startup.port).toBe(7777);
        expect(startup.source).toBe("dx.config");
      });
    } finally {
      if (prev === undefined) delete Bun.env.PORT;
      else Bun.env.PORT = prev;
    }
  });

  test("parseDashboardCliPort reads --port from argv", () => {
    expect(parseDashboardCliPort(["bun", "index.ts", "--port=4242"])).toBe(4242);
    expect(parseDashboardCliPort(["bun", "run", "index.ts", "-p", "5151"])).toBe(5151);
  });

  test("resolveDashboardStartupPort uses repo dx.config [dashboard].port", async () => {
    const prev = Bun.env.PORT;
    delete Bun.env.PORT;
    try {
      const startup = await resolveDashboardStartupPort(REPO_ROOT);
      expect(startup.port).toBe(5678);
      expect(startup.source).toBe("dx.config");
    } finally {
      if (prev === undefined) delete Bun.env.PORT;
      else Bun.env.PORT = prev;
    }
  });

  test("resolveDashboardSettings reports cardCount 67 for repo", async () => {
    const settings = await resolveDashboardSettings(REPO_ROOT, {
      requestUrl: new URL("http://127.0.0.1:5678/"),
    });
    expect(settings.schemaVersion).toBe(1);
    expect(settings.port).toBe(5678);
    expect(settings.dashboardUrl).toBe("http://127.0.0.1:5678/");
    expect(settings.cardCount).toBe(67);
    expect(settings.canvasLinkedCount).toBe(25);
    expect(settings.canvasOrphanCount).toBe(42);
    expect(settings.canonicalPort).toBe(5678);
    expect(settings.defaultCanvas).toBeNull();
    expect(settings.retentionMs["1"]).toBeGreaterThan(0);
    expect(settings.identityFieldMaxLen).toBe(128);
  });
});
