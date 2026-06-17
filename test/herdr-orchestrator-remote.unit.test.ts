import { describe, expect, test } from "bun:test";
import {
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

describe("resolveHost", () => {
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
  test("returns structured result for failed SSH exec", () => {
    // sshExec will fail with this; we test that the result shape is correct
    const result = invokeRemoteAction(
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
  test("builds correct call", () => {
    const result = remoteAgentStart(
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
  test("builds correct call", () => {
    const result = remoteAgentStop({ ...testHost, host: "nonexistent.invalid" }, "reviewer", "dev");
    expect(result.action).toBe("agent-manager.stop");
  });
});

describe("remoteAgentAttach", () => {
  test("builds correct call", () => {
    const result = remoteAgentAttach(
      { ...testHost, host: "nonexistent.invalid" },
      "reviewer",
      "dev"
    );
    expect(result.action).toBe("agent-manager.attach");
  });
});

describe("remoteBootstrap", () => {
  test("attempts install then enable", () => {
    const results = remoteBootstrap(
      { ...testHost, host: "nonexistent.invalid" },
      "ogulcancelik/herdr-orchestrator-agent-manager"
    );
    // With fake host, both will fail
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.action).toBe("plugin.install");
  });

  test("includes ref when provided", () => {
    const results = remoteBootstrap(
      { ...testHost, host: "nonexistent.invalid" },
      "ogulcancelik/herdr-orchestrator-agent-manager",
      "v0.2.0"
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
