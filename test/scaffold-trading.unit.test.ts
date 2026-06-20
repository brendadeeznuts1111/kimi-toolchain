import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { removePath } from "../src/lib/bun-io.ts";
import { readableStreamToText } from "../src/lib/bun-utils.ts";
import { parseKimiModules, scaffoldKimiModules } from "../src/lib/scaffold-modules.ts";

const TMP = join(import.meta.dir, ".tmp-scaffold-trading");

function resetTmp(): void {
  removePath(TMP, { recursive: true, force: true });
}

beforeEach(() => resetTmp());
afterEach(() => resetTmp());

describe("scaffold-trading", () => {
  test("parseKimiModules accepts trading", () => {
    expect(parseKimiModules({ KIMI_MODULES: "trading" })).toEqual(["trading"]);
    expect(parseKimiModules({ KIMI_MODULES: "doctor,trading" })).toEqual(["doctor", "trading"]);
  });

  test("scaffoldKimiModules writes trading loop files", async () => {
    await Bun.write(
      join(TMP, "package.json"),
      JSON.stringify({ name: "trading-demo", scripts: {} })
    );

    const result = await scaffoldKimiModules(TMP, ["trading"], false);

    expect(result.modules).toEqual(["trading"]);
    expect(result.filesWritten.some((p) => p.endsWith("src/trading/gates/registry.ts"))).toBe(true);
    expect(result.filesWritten.some((p) => p.endsWith("src/bin/trading-doctor.ts"))).toBe(true);

    const pkg = (await Bun.file(join(TMP, "package.json")).json()) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["trading:gates"]).toContain("trading-doctor.ts");
  });

  test("trading-doctor runs full gate closure after scaffold", async () => {
    await Bun.write(
      join(TMP, "package.json"),
      JSON.stringify({ name: "trading-demo", scripts: {} })
    );
    await scaffoldKimiModules(TMP, ["trading"], false);

    const proc = Bun.spawn(
      ["bun", "run", join(TMP, "src/bin/trading-doctor.ts"), "--all", "--json"],
      {
        cwd: TMP,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const code = await proc.exited;
    const stdout = await readableStreamToText(proc.stdout);

    expect(code).toBe(0);
    const payload = JSON.parse(stdout) as { order: string[]; results: { gate: string }[] };
    expect(payload.order).toEqual([
      "data-freshness",
      "risk-limits",
      "strategy-performance",
      "model-drift",
    ]);
    expect(payload.results.map((r) => r.gate)).toEqual(payload.order);
  });
});
