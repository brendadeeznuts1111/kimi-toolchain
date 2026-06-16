import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  checkDxCloudflareConfig,
  DEFAULT_DX_CLOUDFLARE_CONFIG,
  evaluateDxCloudflareConfig,
  parseDxCloudflareConfig,
} from "../src/lib/dx-cloudflare-config.ts";

let projectDir: string;

function writeProjectDxConfig(content: string): void {
  writeFileSync(join(projectDir, "dx.config.toml"), content);
}

beforeEach(() => {
  projectDir = join(tmpdir(), `kimi-dx-cloudflare-${Bun.randomUUIDv7()}`);
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
});

const VALID_DX_CONFIG = `
schemaVersion = 1
scope = "project"

[cloudflare]
mode = "read-only"
accountIdEnv = "CLOUDFLARE_ACCOUNT_ID"
apiTokenEnv = "CLOUDFLARE_API_TOKEN"

[cloudflare.dashboard]
enabled = true
title = "DX Dashboard"
homepagePath = "/"
source = "snapshot"
snapshotCommand = "kimi-cloudflare-access dashboard --json"
access = "cloudflare-sso"

[cloudflare.domain]
managed = true
zone = ""
hostname = ""
accessRequired = true
tls = "managed"

[cloudflare.access]
policyFile = ".cloudflare-access.yml"
appLauncherVisible = true
sessionDuration = "24h"

[cloudflare.mcp]
server = "cloudflare-api"
url = "https://mcp.cloudflare.com/mcp"
auth = "cloudflare-sso-oauth"
readOnlyByDefault = true
mutationMode = "manual-script"
`;

describe("dx-cloudflare-config", () => {
  test("passes for the default dashboard/homepage contract", async () => {
    writeProjectDxConfig(VALID_DX_CONFIG);

    const report = await checkDxCloudflareConfig(projectDir);

    expect(report.applicable).toBe(true);
    expect(report.aligned).toBe(true);
    expect(report.checks.every((check) => check.status === "ok")).toBe(true);
  });

  test("keeps missing cloudflare config non-applicable", async () => {
    writeProjectDxConfig('schemaVersion = 1\nscope = "project"\n');

    const report = await checkDxCloudflareConfig(projectDir);

    expect(report.applicable).toBe(false);
    expect(report.aligned).toBe(true);
    expect(report.checks).toEqual([]);
  });

  test("warns on parseable TOML with wrong nested shapes", async () => {
    writeProjectDxConfig(
      VALID_DX_CONFIG.replace('mode = "read-only"', "mode = 1")
        .replace("enabled = true", 'enabled = "yes"')
        .replace("readOnlyByDefault = true", "readOnlyByDefault = []")
    );

    const report = await checkDxCloudflareConfig(projectDir);

    expect(report.applicable).toBe(true);
    expect(report.aligned).toBe(false);
    expect(report.checks.find((check) => check.name === "cloudflare.mode")?.status).toBe("warn");
    expect(
      report.checks.find((check) => check.name === "cloudflare.dashboard.enabled")?.status
    ).toBe("warn");
    expect(
      report.checks.find((check) => check.name === "cloudflare.mcp.readOnlyByDefault")?.status
    ).toBe("warn");
  });

  test("warns when the contract drifts away from safe Cloudflare defaults", () => {
    const result = parseDxCloudflareConfig(
      Bun.TOML.parse(
        VALID_DX_CONFIG.replace('source = "snapshot"', 'source = "live-api"')
          .replace('access = "cloudflare-sso"', 'access = "private"')
          .replace('mutationMode = "manual-script"', 'mutationMode = "disabled"')
      )
    );

    const report = evaluateDxCloudflareConfig(result);

    expect(report.aligned).toBe(false);
    expect(
      report.checks.find((check) => check.name === "cloudflare.dashboard.source")?.status
    ).toBe("warn");
    expect(
      report.checks.find((check) => check.name === "cloudflare.dashboard.access")?.status
    ).toBe("warn");
    expect(
      report.checks.find((check) => check.name === "cloudflare.mcp.mutationMode")?.status
    ).toBe("ok");
  });

  test("project and scaffold dx configs keep the Cloudflare defaults in parity", () => {
    const projectConfig = parseDxCloudflareConfig(
      Bun.TOML.parse(readFileSync(join(import.meta.dir, "..", "dx.config.toml"), "utf8"))
    );
    const scaffoldConfig = parseDxCloudflareConfig(
      Bun.TOML.parse(
        readFileSync(
          join(import.meta.dir, "..", "templates", "scaffold", "dx.config.app.toml"),
          "utf8"
        )
      )
    );

    expect(projectConfig.issues).toEqual([]);
    expect(scaffoldConfig.issues).toEqual([]);
    expect(projectConfig.config).toEqual(DEFAULT_DX_CLOUDFLARE_CONFIG);
    expect(scaffoldConfig.config).toEqual(DEFAULT_DX_CLOUDFLARE_CONFIG);
  });
});
