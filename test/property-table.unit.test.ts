import { describe, expect, test } from "bun:test";
import { join } from "path";
import { writeText } from "../src/lib/bun-io.ts";
import {
  readPropertyTableDxConfig,
  resolvePropertyTableInput,
} from "../src/lib/property-table-config.ts";
import {
  buildPropertyTable,
  formatPropertyTableMarkdown,
  PROPERTY_TABLE_COLUMNS,
} from "../src/lib/property-table.ts";
import { REPO_ROOT, testTempDir } from "./helpers.ts";

const FIXTURE = "test/fixtures/property-table-target.ts";

describe("property-table", () => {
  test("buildPropertyTable extracts JSDoc columns and required rules", async () => {
    const result = await buildPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: FIXTURE,
      className: "DemoConfig",
    });

    expect(result.rows.length).toBe(4);
    expect(PROPERTY_TABLE_COLUMNS).toEqual([
      "Property",
      "Type",
      "Default",
      "Required",
      "Description",
      "Min",
      "Max",
      "Example",
      "EnvVar",
      "DeprecatedIn",
      "LastModified",
    ]);

    const apiUrl = result.rows.find((r) => r.Property === "apiUrl")!;
    expect(apiUrl.Type).toBe("string");
    expect(apiUrl.Required).toBe("yes");
    expect(apiUrl.Description).toContain("API base URL");
    expect(apiUrl.Example).toBe("https://api.example.com");
    expect(apiUrl.EnvVar).toBe("DEMO_API_URL");

    const timeout = result.rows.find((r) => r.Property === "timeout")!;
    expect(timeout.Required).toBe("no");
    expect(timeout.Default).toBe("30000");
    expect(timeout.Min).toBe("1000");
    expect(timeout.Max).toBe("60000");

    const apiKey = result.rows.find((r) => r.Property === "apiKey")!;
    expect(apiKey.Required).toBe("yes");

    const legacy = result.rows.find((r) => r.Property === "legacyMode")!;
    expect(legacy.DeprecatedIn).toBe("2.0.0");
  }, 10_000);

  test("formatPropertyTableMarkdown uses em dash for empty cells", () => {
    const md = formatPropertyTableMarkdown({
      className: "DemoConfig",
      filePath: FIXTURE,
      rows: [
        {
          Property: "apiUrl",
          Type: "string",
          Default: "—",
          Required: "yes",
          Description: "API base URL",
          Min: "—",
          Max: "—",
          Example: "—",
          EnvVar: "—",
          DeprecatedIn: "—",
          LastModified: "—",
        },
      ],
    });
    expect(md).toContain("| Property | Type |");
    expect(md).toContain("DemoConfig");
    expect(md.includes("—")).toBe(true);
  });

  test("resolvePropertyTableInput prefers CLI over dx.config.toml", async () => {
    const dir = testTempDir("property-table-config-");
    writeText(
      join(dir, "dx.config.toml"),
      `[dx.propertyTable]\nfile = "from-dx.ts"\nclass = "FromDx"\n`
    );

    const dx = await readPropertyTableDxConfig(dir);
    const resolved = resolvePropertyTableInput(
      dir,
      { file: "from-cli.ts", className: "FromCli" },
      dx
    );
    expect(resolved.file).toBe("from-cli.ts");
    expect(resolved.className).toBe("FromCli");
    expect(resolved.source).toBe("cli");
  });

  test("buildPropertyTable lists available types when class is missing", async () => {
    await expect(
      buildPropertyTable({
        projectRoot: REPO_ROOT,
        filePath: FIXTURE,
        className: "MissingConfig",
      })
    ).rejects.toThrow(/Available types/);
  }, 10_000);

  test("readPropertyTableDxConfig loads repo defaults", async () => {
    const dx = await readPropertyTableDxConfig(REPO_ROOT);
    expect(dx.file).toBe("test/fixtures/property-table-target.ts");
    expect(dx.class).toBe("DemoConfig");
  });
});
