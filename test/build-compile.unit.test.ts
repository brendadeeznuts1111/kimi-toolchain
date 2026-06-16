import { describe, expect, test } from "bun:test";
import { buildCompilePlan } from "../scripts/build-compile.ts";

describe("build-compile", () => {
  test("plans extensionless output paths from package bin entries", () => {
    const plan = buildCompilePlan({
      bin: {
        "kimi-doctor": "src/bin/kimi-doctor.ts",
        "kimi-dashboard": "src/bin/kimi-dashboard.ts",
      },
    });

    expect(plan).toEqual([
      {
        name: "kimi-dashboard",
        entrypoint: "src/bin/kimi-dashboard.ts",
        outfile: "dist/kimi-dashboard",
      },
      {
        name: "kimi-doctor",
        entrypoint: "src/bin/kimi-doctor.ts",
        outfile: "dist/kimi-doctor",
      },
    ]);
  });

  test("filters entries with --only names", () => {
    const plan = buildCompilePlan(
      {
        bin: {
          "kimi-doctor": "src/bin/kimi-doctor.ts",
          "kimi-dashboard": "src/bin/kimi-dashboard.ts",
        },
      },
      { only: ["kimi-doctor"] }
    );

    expect(plan.map((entry) => entry.name)).toEqual(["kimi-doctor"]);
  });
});
