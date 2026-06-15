import { describe, expect, test } from "bun:test";
import {
  analyzeImpact,
  buildModuleGraph,
  parseImportSpecifiers,
  resolveImport,
  type ImpactConfig,
} from "../src/lib/ci-impact.ts";

const config: ImpactConfig = {
  version: 1,
  docsOnly: ["**/*.md"],
  configOnly: [".github/**", "ci/**"],
  fullRun: ["package.json"],
  risky: ["src/**", "scripts/**", "test/**", "bench/**"],
  security: ["bun.lock"],
  benchmarks: [{ id: "core", paths: ["bench/**"] }],
  targets: [],
};

describe("ci impact analysis", () => {
  test("parses static, dynamic, and require imports", () => {
    expect(
      parseImportSpecifiers(`
        import { x } from "../src/lib/x.ts";
        import "../setup.ts";
        export { y } from "./y.ts";
        await import("./lazy.ts");
        require("./cjs.ts");
      `)
    ).toEqual(["../src/lib/x.ts", "../setup.ts", "./y.ts", "./lazy.ts", "./cjs.ts"]);
  });

  test("resolves relative imports with TypeScript extensions", () => {
    const files = new Set(["src/lib/a.ts", "src/lib/b.ts", "src/lib/nested/index.ts"]);
    expect(resolveImport("src/lib/a.ts", "./b.ts", files)).toBe("src/lib/b.ts");
    expect(resolveImport("src/lib/a.ts", "./nested", files)).toBe("src/lib/nested/index.ts");
    expect(resolveImport("src/lib/a.ts", "effect", files)).toBeNull();
  });

  test("selects tests through the import dependency graph", async () => {
    const root = await makeFixture({
      "src/lib/math.ts": "export const add = (a: number, b: number) => a + b;\n",
      "test/lib.unit.test.ts": 'import { add } from "../src/lib/math.ts";\n',
      "README.md": "# docs\n",
    });
    try {
      const graph = await buildModuleGraph(root, [
        "src/lib/math.ts",
        "test/lib.unit.test.ts",
        "README.md",
      ]);
      const impact = analyzeImpact(config, ["src/lib/math.ts"], graph);
      expect(impact.changeType).toBe("source");
      expect(impact.fullRequired).toBe(false);
      expect(impact.unitTests).toEqual(["test/lib.unit.test.ts"]);
    } finally {
      await run(["rm", "-rf", root]);
    }
  });

  test("falls back to full validation for risky untested source changes", async () => {
    const root = await makeFixture({
      "src/lib/untested.ts": "export const value = 1;\n",
    });
    try {
      const graph = await buildModuleGraph(root, ["src/lib/untested.ts"]);
      const impact = analyzeImpact(config, ["src/lib/untested.ts"], graph);
      expect(impact.changeType).toBe("source");
      expect(impact.fullRequired).toBe(true);
      expect(impact.fullReason).toBe("unmatched risky files");
    } finally {
      await run(["rm", "-rf", root]);
    }
  });

  test("full validation includes security scans", () => {
    const impact = analyzeImpact(config, ["package.json"]);
    expect(impact.changeType).toBe("source");
    expect(impact.fullRequired).toBe(true);
    expect(impact.securityRequired).toBe(true);
    expect(impact.matrix).toContainEqual({ gate: "security" });
  });

  test("classifies docs and config changes for gate pruning", () => {
    const docs = analyzeImpact(config, ["README.md"]);
    const ciConfig = analyzeImpact(config, [".github/workflows/ci.yml"]);

    expect(docs.changeType).toBe("docs");
    expect(docs.matrix.map((entry) => entry.gate)).toEqual(["success-metrics", "governance"]);
    expect(ciConfig.changeType).toBe("config");
    expect(ciConfig.matrix.map((entry) => entry.gate)).toEqual(["success-metrics", "governance"]);
  });
});

async function makeFixture(files: Record<string, string>): Promise<string> {
  const root = `/tmp/kimi-ci-impact-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await run(["mkdir", "-p", root]);
  for (const [path, contents] of Object.entries(files)) {
    const fullPath = `${root}/${path}`;
    await run(["mkdir", "-p", fullPath.split("/").slice(0, -1).join("/")]);
    await Bun.write(fullPath, contents);
  }
  return root;
}

async function run(command: string[]): Promise<void> {
  const proc = Bun.spawn(command, { stdout: "ignore", stderr: "inherit" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited ${exitCode}`);
}
