import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  bridgeScriptName,
  generateBridgeScript,
  writeBridgeScript,
} from "../src/lib/mcp-bridge-scaffold.ts";

describe("mcp-bridge-scaffold", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kimi-mcp-bridge-${Bun.randomUUIDv7()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  test("generates filesystem bridge script", () => {
    const script = generateBridgeScript({ kind: "filesystem", name: "proj" });
    expect(script).toContain("#!/usr/bin/env bun");
    expect(script).toContain("read_file");
    expect(script).toContain("list_dir");
    expect(script).toContain("ALLOWED_ROOTS");
  });

  test("generates http bridge script", () => {
    const script = generateBridgeScript({
      kind: "http",
      name: "api",
      targetUrl: "http://localhost:3000",
    });
    expect(script).toContain("TARGET_URL");
    expect(script).toContain("http://localhost:3000");
  });

  test("generates sandbox bridge script", () => {
    const script = generateBridgeScript({ kind: "sandbox", name: "dry" });
    expect(script).toContain("[sandbox]");
    expect(script).toContain("[dry-run]");
  });

  test("generates dashboard bridge script", () => {
    const script = generateBridgeScript({ kind: "dashboard", name: "kimi-dashboard" });
    expect(script).toContain("dashboard bridge");
    expect(script).toContain("kimi-dashboard-mcp.ts");
    expect(script).toContain("Bun.spawn");
  });

  test("writes bridge script to disk", async () => {
    const path = await writeBridgeScript({ kind: "filesystem", name: "proj" }, tmpDir);
    expect(path).toContain(bridgeScriptName("proj", "filesystem"));
    const text = await Bun.file(path).text();
    expect(text).toContain("proj filesystem bridge");
  });
});
