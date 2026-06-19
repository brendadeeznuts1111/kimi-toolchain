import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { extractAgentsNextSteps } from "../../src/lib/dx-config-agents.ts";
import {
  DxConfigTest,
  getMergedConfig,
  summarizeDxConfigError,
} from "../../src/lib/effect/dx-config.ts";
import { extractPropertyTableDxConfig } from "../../src/lib/property-table-config.ts";
import { ConfigParseError } from "../../src/lib/effect/errors.ts";

describe("dx-config", () => {
  test("DxConfigTest layer serves merged document slices", async () => {
    const document = {
      agents: { iterate: "bun run check:fast" },
      dx: { propertyTable: { file: "a.ts", class: "App" } },
    };
    const steps = await Effect.runPromise(
      getMergedConfig(".").pipe(
        Effect.map(extractAgentsNextSteps),
        Effect.provide(DxConfigTest(document, { projectPath: "dx.config.toml" }))
      )
    );
    expect(steps).toEqual(["bun run check:fast"]);
    expect(extractPropertyTableDxConfig(document)).toEqual({ file: "a.ts", class: "App" });
  });

  test("summarizeDxConfigError formats tagged errors", () => {
    const summary = summarizeDxConfigError(
      new ConfigParseError({ path: "dx.config.toml", cause: "bad TOML" })
    );
    expect(summary.tag).toBe("ConfigParseError");
    expect(summary.message).toContain("dx.config.toml");
    expect(summary.path).toBe("dx.config.toml");
  });
});
