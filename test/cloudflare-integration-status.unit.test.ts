import { makeDir, pathExists, removePath, writeText } from "../src/lib/bun-io.ts";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { buildCloudflareIntegrationStatus } from "../src/lib/cloudflare-integration-status.ts";

import { testTempDir } from "./helpers.ts";
let tmpHome: string;
let projectRoot: string;

const nullSecrets = {
  get: async () => null,
};

function fixedNow(): Date {
  return new Date("2026-06-15T12:00:00.000Z");
}

function writeDxConfig(extra = "") {
  writeText(
    join(projectRoot, "dx.config.toml"),
    `
schemaVersion = 1
scope = "project"

[cloudflare]
mode = "read-only"

[cloudflare.dashboard]
source = "snapshot"
${extra}

[identity.profiles.personal]
userName = "Test User"
userEmail = "test@example.com"
pathPatterns = ["${projectRoot}"]
remotePatterns = ["github.com/example/*"]
`
  );
}

beforeEach(() => {
  tmpHome = testTempDir("kimi-cf-status-");
  projectRoot = join(tmpHome, "kimi-toolchain");
  makeDir(join(tmpHome, ".kimi-code"), { recursive: true });
  makeDir(projectRoot, { recursive: true });
  writeDxConfig();
});

afterEach(() => {
  if (pathExists(tmpHome)) removePath(tmpHome, { recursive: true, force: true });
});

describe("cloudflare-integration-status", () => {
  test("builds an ok read-only snapshot from env credentials and local config", async () => {
    await Bun.write(
      join(tmpHome, ".kimi-code", "mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            "cloudflare-api": { url: "https://mcp.cloudflare.com/mcp" },
            "unified-shell": { command: "bun", args: ["run", "bridge.ts"] },
          },
        },
        null,
        2
      )
    );
    await Bun.write(join(projectRoot, "wrangler.toml"), 'name = "dx-home"\n');
    await Bun.write(join(projectRoot, ".cloudflare-access.yml"), "apps: []\n");

    const status = await buildCloudflareIntegrationStatus({
      home: tmpHome,
      projectRoot,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "account-id",
        CLOUDFLARE_API_TOKEN: "api-token",
      },
      secrets: nullSecrets,
      detectWrangler: async () => ({ available: true, path: "/bin/wrangler", version: "4.91.0" }),
      now: fixedNow,
    });

    expect(status.generatedAt).toBe("2026-06-15T12:00:00.000Z");
    expect(status.overall).toBe("ok");
    expect(status.credentials.source).toBe("env");
    expect(status.credentials.usable).toBe(true);
    expect(status.mcp.cloudflareApiConfigured).toBe(true);
    expect(status.mcp.unifiedShellConfigured).toBe(true);
    expect(status.projectFiles.wranglerConfig?.endsWith("wrangler.toml")).toBe(true);
    expect(status.projectFiles.accessPolicy?.endsWith(".cloudflare-access.yml")).toBe(true);
    expect(status.identity.configured).toBe(true);
    expect(status.summary).toEqual({ errors: 0, warnings: 0, actions: 0 });
    expect(status.diagnostics).toEqual([]);
    expect(status.actions).toEqual([]);
  });

  test("keeps missing local integration pieces as warnings with safe actions", async () => {
    const status = await buildCloudflareIntegrationStatus({
      home: tmpHome,
      projectRoot,
      env: {},
      secrets: nullSecrets,
      detectWrangler: async () => ({ available: false }),
      now: fixedNow,
    });

    expect(status.overall).toBe("warn");
    expect(status.credentials.source).toBe("missing");
    expect(status.mcp.cloudflareApiConfigured).toBe(false);
    expect(status.wrangler.available).toBe(false);
    expect(status.actions.map((action) => action.command)).toEqual([
      "kimi-cloudflare-access login",
      "kimi-doctor --fix",
      "create wrangler config proposal",
      "create .cloudflare-access.yml proposal",
    ]);
    expect(status.actions.every((action) => action.safety !== "read_only")).toBe(true);
  });

  test("surfaces DX Cloudflare contract drift in recommended actions", async () => {
    writeDxConfig('access = "private"');

    const status = await buildCloudflareIntegrationStatus({
      home: tmpHome,
      projectRoot,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "account-id",
        CLOUDFLARE_API_TOKEN: "api-token",
      },
      secrets: nullSecrets,
      detectWrangler: async () => ({ available: true, version: "4.91.0" }),
      now: fixedNow,
    });

    expect(status.dxCloudflare.aligned).toBe(false);
    expect(status.actions.some((action) => action.command.includes("dx.config.toml"))).toBe(true);
  });

  test("tracks missing identity profile as a diagnostic and action", async () => {
    await Bun.write(
      join(projectRoot, "dx.config.toml"),
      `
schemaVersion = 1
scope = "project"

[cloudflare]
mode = "read-only"

[cloudflare.dashboard]
source = "snapshot"
`
    );

    const status = await buildCloudflareIntegrationStatus({
      home: tmpHome,
      projectRoot,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "account-id",
        CLOUDFLARE_API_TOKEN: "api-token",
      },
      secrets: nullSecrets,
      detectWrangler: async () => ({ available: true, version: "4.91.0" }),
      now: fixedNow,
    });

    expect(status.identity.configured).toBe(false);
    expect(
      status.diagnostics.some((diagnostic) => diagnostic.code === "identity-matrix-missing")
    ).toBe(true);
    expect(status.actions.some((action) => action.command.startsWith("kimi-identity"))).toBe(true);
  });
});
