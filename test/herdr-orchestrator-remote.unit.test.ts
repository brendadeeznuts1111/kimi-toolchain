import { describe, expect, test } from "bun:test";
import {
  buildRemoteActionCommand,
  invokeRemoteAction,
  remoteAgentStart,
  remoteAgentStop,
  remoteAgentAttach,
  remoteBootstrap,
  resolveHost,
  resolveAllHosts,
} from "../src/lib/herdr-orchestrator-remote.ts";

// Minimal ResolvedRemoteHost for testing
const testHost = {
  name: "test",
  host: "test.example.com",
  port: undefined as number | undefined,
  user: undefined as string | undefined,
  identityFile: undefined as string | undefined,
  identityFileSource: "none" as const,
  timeout: 15000,
  batchMode: true,
  connectTimeout: 5,
  identitiesOnly: false,
  strictHostKeyChecking: "accept-new" as const,
  userKnownHostsFile: undefined as string | undefined,
  serverAliveInterval: 0,
  serverAliveCountMax: 3,
  controlMaster: "no" as const,
  controlPath: undefined as string | undefined,
  controlPersist: undefined as number | undefined,
  compression: false,
  proxyJump: undefined as string | undefined,
};

describe("herdr-orchestrator-remote resolve-host", () => {
  test("resolves simple string host", () => {
    const resolved = resolveHost("staging", { staging: "staging.example.com" });
    expect(resolved).not.toBeNull();
    expect(resolved!.host).toBe("staging.example.com");
  });

  test("resolves per-host config object", () => {
    const resolved = resolveHost("staging", {
      staging: { host: "staging.example.com", port: 2222, user: "deploy" },
    });
    expect(resolved!.host).toBe("staging.example.com");
    expect(resolved!.port).toBe(2222);
    expect(resolved!.user).toBe("deploy");
  });

  test("returns null for unknown host", () => {
    expect(resolveHost("nonexistent", {})).toBeNull();
  });
});

describe("resolveAllHosts", () => {
  test("returns map of all resolved hosts", () => {
    const map = resolveAllHosts({
      staging: "staging.example.com",
      workbox: { host: "workbox.local", port: 2222 },
    });
    expect(map.size).toBe(2);
    expect(map.get("staging")!.host).toBe("staging.example.com");
    expect(map.get("workbox")!.port).toBe(2222);
  });
});

describe("invokeRemoteAction", () => {
  test("buildRemoteActionCommand propagates artifact identity env", () => {
    const prev = {
      KIMI_CODE_SESSION: Bun.env.KIMI_CODE_SESSION,
      HERDR_PANE_ID: Bun.env.HERDR_PANE_ID,
      KIMI_RUN_ID: Bun.env.KIMI_RUN_ID,
    };
    Bun.env.KIMI_CODE_SESSION = "wd_remote_session";
    Bun.env.HERDR_PANE_ID = "pane_remote_parent";
    Bun.env.KIMI_RUN_ID = "run_remote_parent";
    try {
      const cmd = buildRemoteActionCommand(
        "agent-manager.start",
        {
          session: "remote-dev",
          workspace: "workspace-1",
          env: { AGENT_NAME: "reviewer" },
        },
        ["reviewer"]
      );
      expect(cmd).toContain("--workspace");
      expect(cmd).toContain("workspace-1");
      expect(cmd).toContain("--env");
      expect(cmd).toContain("HERDR_WORKSPACE_ID=workspace-1");
      expect(cmd).toContain("HERDR_SESSION_ID=remote-dev");
      expect(cmd).toContain("KIMI_CODE_SESSION=wd_remote_session");
      expect(cmd).toContain("HERDR_PANE_ID=pane_remote_parent");
      expect(cmd).toContain("KIMI_PARENT_RUN_ID=run_remote_parent");
      expect(cmd).toContain("AGENT_NAME=reviewer");
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete Bun.env[key];
        else Bun.env[key] = value;
      }
    }
  });

  test("returns structured result for failed SSH exec", async () => {
    // sshExec will fail with this; we test that the result shape is correct
    const result = await invokeRemoteAction(
      "agent-manager.start",
      { resolved: { ...testHost, host: "nonexistent.invalid" } },
      ["reviewer"]
    );
    expect(result.ok).toBe(false);
    expect(result.action).toBe("agent-manager.start");
    expect(result.hostLabel).toBe("nonexistent.invalid");
  });
});

describe("remoteAgentStart", () => {
  test("builds correct call", async () => {
    const result = await remoteAgentStart(
      { ...testHost, host: "nonexistent.invalid" },
      "reviewer",
      "dev",
      "w1"
    );
    // Will fail SSH but we verify result shape
    expect(result.action).toBe("agent-manager.start");
    expect(result.ok).toBe(false);
  });
});

describe("remoteAgentStop", () => {
  test("builds correct call", async () => {
    const result = await remoteAgentStop(
      { ...testHost, host: "nonexistent.invalid" },
      "reviewer",
      "dev"
    );
    expect(result.action).toBe("agent-manager.stop");
  });
});

describe("remoteAgentAttach", () => {
  test("builds correct call", async () => {
    const result = await remoteAgentAttach(
      { ...testHost, host: "nonexistent.invalid" },
      "reviewer",
      "dev"
    );
    expect(result.action).toBe("agent-manager.attach");
  });
});

describe("remoteBootstrap", () => {
  test("attempts install then enable", async () => {
    const results = await remoteBootstrap(
      { ...testHost, host: "nonexistent.invalid" },
      "ogulcancelik/herdr-orchestrator-agent-manager"
    );
    // With fake host, both will fail
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.action).toBe("plugin.install");
  });

  test("includes ref when provided", async () => {
    const results = await remoteBootstrap(
      { ...testHost, host: "nonexistent.invalid" },
      "ogulcancelik/herdr-orchestrator-agent-manager",
      "v0.2.0"
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
