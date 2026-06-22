import { describe, expect, test } from "bun:test";
import { scanSourceText } from "../src/lib/autophagy-scan.ts";

describe("autophagy-scan", () => {
  test("scanSourceText flags process.env and dead branches", () => {
    const findings = scanSourceText("src/leak.ts", "const x = process.env.TOKEN;\nif (false) {}\n");
    expect(findings.map((f) => f.kind).sort()).toEqual(["dead-branch", "process-env"]);
  });

  test("scanSourceText ignores test paths for process.env", () => {
    const findings = scanSourceText("src/foo.test.ts", "const x = process.env.TOKEN;\n");
    expect(findings).toEqual([]);
  });
});
