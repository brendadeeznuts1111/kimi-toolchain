import { makeDir, removePath } from "../../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { invokeTool } from "../../src/lib/tool-runner.ts";

import { REPO_ROOT } from "../helpers.ts";

const IDENTITY = join(REPO_ROOT, "src/bin/kimi-identity.ts");

const DX_CONFIG = `
schemaVersion = 1
name = "test-dx"
scope = "global"

[identity.profiles.personal]
userName = "Brenda Williams"
userEmail = "205237647+brendadeeznuts1111@users.noreply.github.com"
remotePatterns = ["github.com/brendadeeznuts1111/*"]
pathPatterns = ["~/kimi-toolchain"]
`;

async function runGit(repo: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      LEFTHOOK: "0",
    },
  });
  await Bun.readableStreamToText(proc.stdout);
  await Bun.readableStreamToText(proc.stderr);
  expect(await proc.exited).toBe(0);
}

async function setupFixture(): Promise<{ home: string; repo: string; key: string }> {
  const home = join(REPO_ROOT, `.tmp-identity-home-${Date.now()}`);
  const repo = join(home, "repo");
  const key = join(home, ".ssh", "id_ed25519");
  makeDir(join(home, ".config", "dx"), { recursive: true });
  makeDir(join(home, ".ssh"), { recursive: true });
  makeDir(repo, { recursive: true });
  await Bun.write(join(home, ".config", "dx", "global-config.toml"), DX_CONFIG);
  await Bun.write(key, "not-a-real-key\n");
  await runGit(repo, ["init"]);
  await runGit(repo, [
    "remote",
    "add",
    "origin",
    "git@github.com:brendadeeznuts1111/kimi-toolchain.git",
  ]);
  return { home, repo, key };
}

async function runIdentity(
  home: string,
  repo: string,
  args: string[]
): Promise<{ stdout: string; exitCode: number }> {
  const result = await invokeTool(IDENTITY, args, {
    cwd: repo,
    timeoutMs: 15_000,
    env: {
      HOME: home,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      LEFTHOOK: "0",
    },
  });
  return { stdout: result.stdout + result.stderr, exitCode: result.exitCode };
}

describe("kimi-identity smoke", () => {
  test("list, auto, switch, bind, and sign emit stable JSON", async () => {
    const fixture = await setupFixture();
    try {
      const listed = await runIdentity(fixture.home, fixture.repo, [
        "list",
        "--json",
        "--repo",
        fixture.repo,
      ]);
      expect(listed.exitCode).toBe(0);
      expect(JSON.parse(listed.stdout).profiles[0].name).toBe("personal");

      const detected = await runIdentity(fixture.home, fixture.repo, [
        "auto",
        "--json",
        "--repo",
        fixture.repo,
      ]);
      expect(detected.exitCode).toBe(0);
      expect(JSON.parse(detected.stdout).profile.name).toBe("personal");

      const switched = await runIdentity(fixture.home, fixture.repo, [
        "switch",
        "--profile",
        "personal",
        "--repo",
        fixture.repo,
        "--reason",
        "test",
        "--json",
      ]);
      expect(switched.exitCode).toBe(0);
      expect(JSON.parse(switched.stdout).audit.newProfile).toBe("personal");

      const bound = await runIdentity(fixture.home, fixture.repo, [
        "bind",
        "--profile",
        "personal",
        "--key",
        fixture.key,
        "--json",
      ]);
      expect(bound.exitCode).toBe(0);
      expect(JSON.parse(bound.stdout).profile.sshKey).toBe(fixture.key);

      const signed = await runIdentity(fixture.home, fixture.repo, [
        "sign",
        "--profile",
        "personal",
        "--gpg-key",
        "ABC123",
        "--json",
      ]);
      expect(signed.exitCode).toBe(0);
      expect(JSON.parse(signed.stdout).profile.signingKey).toBe("ABC123");
    } finally {
      removePath(fixture.home, { recursive: true, force: true });
    }
  }, 30_000);
});
