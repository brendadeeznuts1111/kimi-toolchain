import { afterEach, describe, expect, mock, test } from "bun:test";
import { normalizeRemoteHostConfig } from "../src/lib/herdr-orchestrator-config.ts";

const sshRemoteCommands: string[][] = [];

mock.module("../src/lib/governor-spawn.ts", () => ({
  governedSpawn: async (cmd: string[]) => {
    if (cmd[0] !== "ssh") throw new Error(`unexpected spawn: ${cmd.join(" ")}`);
    const remoteStart = cmd.indexOf("--") + 1;
    const remote = cmd.slice(remoteStart);
    sshRemoteCommands.push(remote);
    const key = remote.join(" ");

    if (key === "herdr version") {
      return { stdout: "herdr 0.1.0", stderr: "", exitCode: 0 };
    }
    if (key === "herdr session list --json") {
      return {
        stdout: JSON.stringify({
          sessions: [
            { name: "dev", running: true, default: false, socket_path: "/tmp/herdr.sock" },
          ],
        }),
        stderr: "",
        exitCode: 0,
      };
    }
    if (key === "herdr --session dev workspace list") {
      return {
        stdout: JSON.stringify({
          result: {
            workspaces: [{ workspace_id: "w1" }, { workspace_id: "w2" }, { workspace_id: "w3" }],
          },
        }),
        stderr: "",
        exitCode: 0,
      };
    }
    if (key === "herdr --session dev agent list") {
      return {
        stdout: JSON.stringify({
          result: {
            agents: [
              { workspace_id: "w1", agent: "kimi", pane_id: "p1" },
              { workspace_id: "w2", agent: "codex", pane_id: "p2" },
              { workspace_id: "w3", agent: "claude", pane_id: "p3" },
            ],
          },
        }),
        stderr: "",
        exitCode: 0,
      };
    }

    return { stdout: "", stderr: `unknown remote command: ${key}`, exitCode: 1 };
  },
}));

const { discoverRemoteSessions, discoverRemoteWorkspaceAgents } =
  await import("../src/lib/herdr-orchestrator-remote-discovery.ts");

describe("herdr-orchestrator-remote-discovery", () => {
  afterEach(() => {
    sshRemoteCommands.length = 0;
  });

  test("discoverRemoteSessions calls agent list once per session", async () => {
    const result = await discoverRemoteSessions({ workbox: "workbox.local" });
    const agentListCalls = sshRemoteCommands.filter((cmd) => cmd.join(" ").includes("agent list"));

    expect(agentListCalls).toHaveLength(1);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.workspaceCount).toBe(3);
    expect(result.sessions[0]?.agentCount).toBe(3);
  });

  test("discoverRemoteWorkspaceAgents calls agent list once per session", async () => {
    const resolved = normalizeRemoteHostConfig({ workbox: "workbox.local" }).workbox!;
    const agents = await discoverRemoteWorkspaceAgents("workbox", resolved, "dev");
    const agentListCalls = sshRemoteCommands.filter((cmd) => cmd.join(" ").includes("agent list"));

    expect(agentListCalls).toHaveLength(1);
    expect(agents).toHaveLength(3);
    expect(agents.map((a) => a.agent).sort()).toEqual(["claude", "codex", "kimi"]);
  });
});
