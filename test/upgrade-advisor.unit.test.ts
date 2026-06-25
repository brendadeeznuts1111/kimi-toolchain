import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import { scanUpgradeAdvisor } from "../src/lib/upgrade-advisor.ts";
import { testTempDir } from "./helpers.ts";

describe("upgrade-advisor", () => {
  test("detects sharp import", async () => {
    const root = testTempDir("upgrade-advisor-");
    makeDir(join(root, "src"), { recursive: true });
    writeText(
      join(root, "src", "resize.ts"),
      "import sharp from 'sharp';\nexport const x = sharp;\n"
    );
    const report = await scanUpgradeAdvisor(root, { rules: ["sharp-to-bun-image"] });
    expect(report.findings.length).toBe(1);
    expect(report.findings[0]?.file).toBe("src/resize.ts");
    expect(report.findings[0]?.line).toBe(1);
  });

  test("detects Promise.all with multiple fetch", async () => {
    const root = testTempDir("upgrade-advisor-");
    makeDir(join(root, "src"), { recursive: true });
    writeText(
      join(root, "src", "api.ts"),
      `await Promise.all([
  fetch("https://api.example.com/a"),
  fetch("https://api.example.com/b"),
]);
`
    );
    const report = await scanUpgradeAdvisor(root, { rules: ["fetch-http2-multiplex"] });
    expect(report.findings.length).toBe(1);
    expect(report.findings[0]?.ruleId).toBe("fetch-http2-multiplex");
  });

  test("detects Bun.serve TLS without http3", async () => {
    const root = testTempDir("upgrade-advisor-");
    makeDir(join(root, "src"), { recursive: true });
    writeText(
      join(root, "src", "server.ts"),
      `Bun.serve({
  tls: { cert: "", key: "" },
  fetch() { return new Response("ok"); } });
`
    );
    const report = await scanUpgradeAdvisor(root, { rules: ["bun-serve-http3"] });
    expect(report.findings.length).toBe(1);
  });

  test("detects chokidar import", async () => {
    const root = testTempDir("upgrade-advisor-");
    makeDir(join(root, "scripts"), { recursive: true });
    writeText(join(root, "scripts", "watch.ts"), "import chokidar from 'chokidar';\n");
    const report = await scanUpgradeAdvisor(root, { rules: ["legacy-file-watchers"] });
    expect(report.findings.length).toBe(1);
  });

  test("detects isolated linker without globalStore", async () => {
    const root = testTempDir("upgrade-advisor-");
    writeText(
      join(root, "bunfig.toml"),
      `[install]
linker = "isolated"
`
    );
    const report = await scanUpgradeAdvisor(root, { rules: ["global-store-disabled"] });
    expect(report.findings.length).toBe(1);
    expect(report.findings[0]?.file).toBe("bunfig.toml");
  });

  test("detects missing --no-orphans on dev script", async () => {
    const root = testTempDir("upgrade-advisor-");
    writeText(
      join(root, "package.json"),
      JSON.stringify({ scripts: { dev: "bun run src/index.ts" } }, null, 2)
    );
    const report = await scanUpgradeAdvisor(root, { rules: ["missing-no-orphans"] });
    expect(report.findings.length).toBe(1);
  });

  test("detects missing parallel test scripts", async () => {
    const root = testTempDir("upgrade-advisor-");
    writeText(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "bun test" } }, null, 2)
    );
    const report = await scanUpgradeAdvisor(root, { rules: ["missing-parallel-test-scripts"] });
    expect(report.findings.length).toBe(1);
  });

  test("detects electron dependency", async () => {
    const root = testTempDir("upgrade-advisor-");
    writeText(
      join(root, "package.json"),
      JSON.stringify({ devDependencies: { electron: "^30.0.0" } }, null, 2)
    );
    const report = await scanUpgradeAdvisor(root, { rules: ["electron-to-bun-webview"] });
    expect(report.findings.length).toBe(1);
  });

  test("detects manual source map decode", async () => {
    const root = testTempDir("upgrade-advisor-");
    makeDir(join(root, "src"), { recursive: true });
    writeText(
      join(root, "src", "map.ts"),
      "import { TraceMap } from '@jridgewell/trace-mapping';\n"
    );
    const report = await scanUpgradeAdvisor(root, { rules: ["manual-source-map-decode"] });
    expect(report.findings.length).toBe(1);
    expect(report.findings[0]?.ruleId).toBe("manual-source-map-decode");
  });

  test("detects raw unix socket client without ws+unix", async () => {
    const root = testTempDir("upgrade-advisor-");
    makeDir(join(root, "src"), { recursive: true });
    writeText(
      join(root, "src", "client.ts"),
      'void Bun.connect({ unix: "/tmp/app.sock", socket: {} });\n'
    );
    const report = await scanUpgradeAdvisor(root, { rules: ["unix-socket-ws-upgrade"] });
    expect(report.findings.length).toBe(1);
    expect(report.findings[0]?.ruleId).toBe("unix-socket-ws-upgrade");
  });

  test("skips unix-socket rule when ws+unix already used", async () => {
    const root = testTempDir("upgrade-advisor-");
    makeDir(join(root, "src"), { recursive: true });
    writeText(
      join(root, "src", "client.ts"),
      'const ws = new WebSocket("ws+unix:///tmp/app.sock:/");\n'
    );
    const report = await scanUpgradeAdvisor(root, { rules: ["unix-socket-ws-upgrade"] });
    expect(report.findings.length).toBe(0);
  });

  test("returns empty report for clean minimal project", async () => {
    const root = testTempDir("upgrade-advisor-");
    writeText(join(root, "package.json"), JSON.stringify({ name: "clean" }, null, 2));
    const report = await scanUpgradeAdvisor(root);
    expect(report.summary.total).toBe(0);
    expect(report.schemaVersion).toBe(1);
  });
});
