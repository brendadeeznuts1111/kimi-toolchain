import { afterEach, describe, expect, test } from "bun:test";
import { normalizeRemoteHostConfig } from "../src/lib/herdr-orchestrator-config.ts";
import {
  buildRemoteHostsStatus,
  parseHerdrVersionOutput,
  probeRemoteHost,
  probeRemoteHosts,
} from "../src/lib/herdr-remote-host-probe.ts";
import type { ResolvedRemoteHost } from "../src/lib/herdr-orchestrator-config.ts";
import type { SshExecResult } from "../src/lib/herdr-orchestrator.ts";

const sshRemoteCommands: string[][] = [];

async function fakeSshExec(
  resolved: ResolvedRemoteHost,
  command: string[]
): Promise<SshExecResult> {
  sshRemoteCommands.push(command);
  if (command.join(" ") === "herdr version") {
    if (resolved.host.includes("staging")) {
      return { ok: true, output: "herdr 0.9.4" };
    }
    return { ok: false, output: "connection timed out", code: 255 };
  }
  return { ok: false, output: `unknown remote command: ${command.join(" ")}`, code: 1 };
}

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
    const result = await probeRemoteHost("staging", resolved, { sshExec: fakeSshExec });
    expect(result.reachable).toBe(true);
    expect(result.version).toBe("0.9.4");
    expect(sshRemoteCommands).toEqual([["herdr", "version"]]);
  });

  test("probeRemoteHosts runs hosts in parallel and aggregates status", async () => {
    const status = await probeRemoteHosts(
      {
        staging: "staging.local",
        workbox: "workbox.local",
      },
      undefined,
      { sshExec: fakeSshExec }
    );
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
