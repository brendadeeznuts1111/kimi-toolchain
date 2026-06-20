import { mock } from "bun:test";

type GovernedSpawn = typeof import("../../src/lib/governor-spawn.ts").governedSpawn;

const realGovernedSpawn = (await import("../../src/lib/governor-spawn.ts")).governedSpawn;

/** SSH-only mock — forwards non-ssh commands to the captured real governedSpawn. */
export function installGovernorSpawnSshMock(
  onSsh: (
    remote: string[],
    cmd: string[]
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
): void {
  mock.module("../../src/lib/governor-spawn.ts", () => ({
    governedSpawn: async (cmd: string[], options?: Parameters<GovernedSpawn>[1]) => {
      if (cmd[0] !== "ssh") {
        return realGovernedSpawn(cmd, options);
      }
      const remoteStart = cmd.indexOf("--") + 1;
      const remote = cmd.slice(remoteStart);
      return onSsh(remote, cmd);
    },
  }));
}
