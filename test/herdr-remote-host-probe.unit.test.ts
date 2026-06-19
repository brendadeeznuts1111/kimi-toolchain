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
      const dash = cmd.indexOf("--");
      const target = dash > 0 ? (cmd[dash - 1] ?? "") : "";
      if (target.includes("staging")) {
        return { stdout: "herdr 0.9.4", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "connection timed out", exitCode: 255 };
    }

    return { stdout: "", stderr: `unknown remote command: ${key}`, exitCode: 1 };
  },
}));

const { buildRemoteHostsStatus, parseHerdrVersionOutput, probeRemoteHost, probeRemoteHosts } =
  await import("../src/lib/herdr-remote-host-probe.ts");

describe("herdr-remote-host-probe", () => {
  afterEach(() => {
    sshRemoteCommands.length = 0;
  });

  test("parseHerdrVersionOutput extracts semver from first line", () => {
    expect(parseHerdrVersionOutput("herdr 0.9.4\nchannel: stable")).toBe("0.9.4");
    expect(parseHerdrVersionOutput("plain output")).toBe("plain output");
  });

  test("probeRemoteHost returns reachable host with version", async () => {
    const resolved = normalizeRemoteHostConfig({ staging: "staging.local" }).staging!;
    const result = await probeRemoteHost("staging", resolved);
    expect(result.reachable).toBe(true);
    expect(result.version).toBe("0.9.4");
    expect(sshRemoteCommands).toEqual([["herdr", "version"]]);
  });

  test("probeRemoteHosts runs hosts in parallel and aggregates status", async () => {
    const status = await probeRemoteHosts({
      staging: "staging.local",
      workbox: "workbox.local",
    });
    expect(status.configured).toBe(2);
    expect(status.reachable).toBe(1);
    expect(status.hosts).toHaveLength(2);
    expect(status.hosts.find((host) => host.label === "staging")?.reachable).toBe(true);
    expect(status.hosts.find((host) => host.label === "workbox")?.reachable).toBe(false);
    expect(
      sshRemoteCommands.filter((cmd) => cmd.join(" ") === "herdr version").length
    ).toBeGreaterThanOrEqual(2);
  });

  test("buildRemoteHostsStatus counts reachable hosts", () => {
    const status = buildRemoteHostsStatus([
      { label: "a", reachable: true, version: "1.0.0" },
      { label: "b", reachable: false, error: "down" },
    ]);
    expect(status.configured).toBe(2);
    expect(status.reachable).toBe(1);
  });
});
