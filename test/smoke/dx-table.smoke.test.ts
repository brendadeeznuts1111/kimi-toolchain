import { join } from "path";
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { removePath } from "../../src/lib/bun-io.ts";
import { invokeTool } from "../../src/lib/tool-runner.ts";
import { REPO_ROOT, testTempDir } from "../helpers.ts";

const DX_TABLE = join(REPO_ROOT, "scripts/dx-table.ts");
const DX_TABLE_CONTRACT = join(REPO_ROOT, "scripts/dx-table-contract.ts");
const ENDPOINTS_FIXTURE = join(REPO_ROOT, "test/fixtures/dx-url-endpoints.toml");

async function runDxTable(args: string[], cwd = REPO_ROOT) {
  return invokeTool(DX_TABLE, args, { cwd, timeoutMs: 30_000 });
}

function parseJsonStdout(stdout: string): unknown {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error(`No JSON object in stdout: ${stdout.slice(0, 200)}`);
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

function toolOutput(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`;
}

function writeInventoryConfig(
  dir: string,
  options: { name: string; schemaVersion: number; endpoints: Array<{ name: string; url: string }> }
): void {
  const lines = [
    `schemaVersion = ${options.schemaVersion}`,
    `name = "${options.name}"`,
    `scope = "project"`,
    "",
    ...options.endpoints.flatMap((endpoint) => [
      "[[endpoints]]",
      `name = "${endpoint.name}"`,
      `url = "${endpoint.url}"`,
      "",
    ]),
  ];
  Bun.write(join(dir, "dx.config.toml"), lines.join("\n"));
}

describe("dx-table smoke", () => {
  let inventoryRoots: string[] = [];

  beforeEach(() => {
    inventoryRoots = [];
  });

  afterEach(() => {
    for (const root of inventoryRoots) {
      removePath(root, { recursive: true, force: true });
    }
  });

  test("dx:table:contract validates endpoint schemas on fixture", async () => {
    const result = await invokeTool(DX_TABLE_CONTRACT, [], { cwd: REPO_ROOT, timeoutMs: 15_000 });
    expect(result.exitCode).toBe(0);
    const output = toolOutput(result);
    expect(output).toContain("OK schemas/endpoints.schema.toml");
    expect(output).toContain("OK schemas/endpoints-strict.schema.toml");
  });

  test("extract endpoints -u --exact emits decomposed JSON rows", async () => {
    const result = await runDxTable([
      "extract",
      ENDPOINTS_FIXTURE,
      "endpoints",
      "--format",
      "json",
      "-u",
      "--exact",
    ]);
    expect(result.exitCode).toBe(0);

    const payload = parseJsonStdout(result.stdout) as {
      title: string;
      columns: string[];
      rows: Record<string, string>[];
    };
    expect(payload.title).toBe("endpoints");
    expect(payload.columns).toContain("url_hostname");
    expect(payload.rows).toHaveLength(3);
    expect(payload.rows.some((row) => row.name === "users" && row.url_port === "8443")).toBe(true);
  });

  test("extract endpoints --schema passes CLI pipeline on fixture", async () => {
    const result = await runDxTable([
      "extract",
      ENDPOINTS_FIXTURE,
      "endpoints",
      "-u",
      "--exact",
      "--schema",
      "schemas/endpoints.schema.toml",
      "--format",
      "csv",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("name,url,url_protocol,url_hostname");
    expect(result.stdout).toContain("users");
    expect(result.stdout).toContain("api.example.com");
  });

  test("extract endpoints --describe --keys name emits keyed JSON catalog", async () => {
    const result = await runDxTable([
      "extract",
      ENDPOINTS_FIXTURE,
      "endpoints",
      "--describe",
      "--keys",
      "name",
      "--format",
      "json",
      "--exact",
    ]);
    expect(result.exitCode).toBe(0);

    const catalog = parseJsonStdout(result.stdout) as {
      keyColumn: string;
      entries: Record<string, Record<string, string>>;
    };
    expect(catalog.keyColumn).toBe("name");
    expect(catalog.entries.users?.url).toContain("api.example.com");
    expect(catalog.entries.health?.url).toContain("/health");
    expect(catalog.entries.staging?.url).toContain("staging.example.com");
  });

  test("inventory merges roots with --add-metadata and column projection", async () => {
    const rootA = testTempDir("dx-table-smoke-a-");
    const rootB = testTempDir("dx-table-smoke-b-");
    inventoryRoots.push(rootA, rootB);

    writeInventoryConfig(rootA, {
      name: "project-a",
      schemaVersion: 2,
      endpoints: [{ name: "alpha", url: "https://a.example/alpha" }],
    });
    writeInventoryConfig(rootB, {
      name: "project-b",
      schemaVersion: 3,
      endpoints: [{ name: "beta", url: "https://b.example/beta" }],
    });

    const result = await runDxTable([
      "inventory",
      "endpoints",
      "--roots",
      `${rootA},${rootB}`,
      "--add-metadata",
      "schemaVersion,name",
      "--columns",
      "name,schemaVersion,config.name",
      "--format",
      "csv",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("name,schemaVersion,config.name");
    expect(result.stdout).toContain("alpha,2,project-a");
    expect(result.stdout).toContain("beta,3,project-b");
  });
});
