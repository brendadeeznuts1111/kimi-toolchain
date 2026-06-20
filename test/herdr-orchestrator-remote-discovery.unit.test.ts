import { afterEach, describe, expect, test } from "bun:test";
import {
  discoverRemoteSessions,
  discoverRemoteWorkspaceAgents,
} from "../src/lib/herdr-orchestrator-remote-discovery.ts";
import {
  normalizeRemoteHostConfig,
  type ResolvedRemoteHost,
} from "../src/lib/herdr-orchestrator-config.ts";
import type { SshExecResult } from "../src/lib/herdr-orchestrator.ts";

const sshRemoteCommands: string[][] = [];

async function fakeSshExec(
  _resolved: ResolvedRemoteHost,
  command: string[]
): Promise<SshExecResult> {
  sshRemoteCommands.push(command);
  const key = command.join(" ");

  if (key === "herdr version") {
    return { ok: true, output: "herdr 0.1.0" };
  }
  if (key === "herdr session list --json") {
    return {
      ok: true,
      output: JSON.stringify({
        sessions: [{ name: "dev", running: true, default: false, socket_path: "/tmp/herdr.sock" }],
      }),
    };
  }
  if (key === "herdr --session dev workspace list") {
    return {
      ok: true,
      output: JSON.stringify({
        result: {
          workspaces: [{ workspace_id: "w1" }, { workspace_id: "w2" }, { workspace_id: "w3" }],
        },
      }),
    };
  }
  if (key === "herdr --session dev agent list") {
    return {
      ok: true,
      output: JSON.stringify({
        result: {
          agents: [
            { workspace_id: "w1", agent: "kimi", pane_id: "p1" },
            { workspace_id: "w2", agent: "codex", pane_id: "p2" },
            { workspace_id: "w3", agent: "claude", pane_id: "p3" },
          ],
        },
      }),
    };
  }

  return { ok: false, output: `unknown remote command: ${key}`, code: 1 };
}

describe("herdr-orchestrator-remote-discovery", () => {
  afterEach(() => {
    sshRemoteCommands.length = 0;
  });

  test("discoverRemoteSessions calls agent list once per session", async () => {
    const result = await discoverRemoteSessions({ workbox: "workbox.local" }, undefined, {
      sshExec: fakeSshExec,
    });
    const agentListCalls = sshRemoteCommands.filter((cmd) => cmd.join(" ").includes("agent list"));

    expect(agentListCalls).toHaveLength(1);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.workspaceCount).toBe(3);
    expect(result.sessions[0]?.agentCount).toBe(3);
  });

  test("discoverRemoteWorkspaceAgents calls agent list once per session", async () => {
    const resolved = normalizeRemoteHostConfig({ workbox: "workbox.local" }).workbox!;
    const agents = await discoverRemoteWorkspaceAgents("workbox", resolved, "dev", {
      sshExec: fakeSshExec,
    });
    const agentListCalls = sshRemoteCommands.filter((cmd) => cmd.join(" ").includes("agent list"));

    expect(agentListCalls).toHaveLength(1);
    expect(agents).toHaveLength(3);
    expect(agents.map((a) => a.agent).sort()).toEqual(["claude", "codex", "kimi"]);
  });
});
