import { makeDir, removePath } from "../src/lib/bun-io.ts";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { testTempDir } from "./helpers.ts";
import {
  buildLatmListReport,
  buildLatmManifest,
  discoverTools,
  isLatmManifest,
  latmToolsForRole,
  pickInvokePane,
  pruneLatmManifests,
  substituteLatmCommand,
  writeLatmManifest,
} from "../src/lib/herdr-latm.ts";
import type { DiscoveredTool } from "../src/lib/herdr-latm.ts";
import { herdrLatmManifestPath } from "../src/lib/paths.ts";

let tmpHome: string;

describe("herdr-latm", () => {
  beforeEach(() => {
    tmpHome = testTempDir("kimi-latm-");
    makeDir(join(tmpHome, ".config", "herdr", "agents", "1-3"), { recursive: true });
  });

  afterEach(() => {
    if (tmpHome) removePath(tmpHome, { recursive: true, force: true });
  });

  test("latmToolsForRole returns doctor tools", () => {
    const tools = latmToolsForRole("doctor");
    expect(tools.some((tool) => tool.name === "effect-gates")).toBe(true);
    expect(tools.every((tool) => tool.readOnly)).toBe(true);
  });

  test("substituteLatmCommand quotes placeholder values", () => {
    const command = substituteLatmCommand("rg -i {query} --json", { query: "TODO's" });
    expect(command).toContain("'TODO'\\''s'");
  });

  test("writeLatmManifest and discoverTools round-trip", async () => {
    const manifest = buildLatmManifest({
      paneId: "1-3",
      workspaceId: "1",
      role: "doctor",
      agentId: "doctor",
    });
    await writeLatmManifest(manifest, tmpHome);

    const path = herdrLatmManifestPath("1-3", tmpHome);
    const raw = await Bun.file(path).json();
    expect(isLatmManifest(raw)).toBe(true);

    const discovered = await discoverTools(tmpHome);
    expect(discovered.some((tool) => tool.name === "effect-gates" && tool.paneId === "1-3")).toBe(
      true
    );
  });

  test("discoverTools marks stale manifests", async () => {
    const manifest = buildLatmManifest({
      paneId: "1-3",
      workspaceId: "1",
      role: "doctor",
      ttlMs: 1,
      now: () => new Date("2020-01-01T00:00:00Z"),
    });
    await writeLatmManifest(manifest, tmpHome);
    const report = await buildLatmListReport(tmpHome);
    expect(report.staleCount).toBeGreaterThan(0);
    expect(report.tools[0]?.stale).toBe(true);
  });

  test("pickInvokePane prefers shell over primary for duplicate tools", () => {
    const base = {
      name: "run_shell",
      description: "shell",
      invoke: { type: "cli" as const, command: "echo" },
      readOnly: false,
      timeoutMs: 1000,
      manifestPath: "/tmp/capabilities.json",
      ageMs: 1000,
      stale: false,
    };
    const tools: DiscoveredTool[] = [
      { ...base, agentId: "kimi", paneId: "wB:p6F", workspaceId: "wB", role: "primary" },
      { ...base, agentId: "shell", paneId: "wB:p23", workspaceId: "wB", role: "shell" },
    ];
    const picked = pickInvokePane("run_shell", tools);
    expect(picked?.paneId).toBe("wB:p23");
  });

  test("pickInvokePane prefers doctor for diagnose_workspace over primary", () => {
    const shared = latmToolsForRole("doctor").find((tool) => tool.name === "diagnose_workspace");
    expect(shared).toBeDefined();
    const tools: DiscoveredTool[] = [
      {
        ...shared!,
        agentId: "doctor",
        paneId: "wB:p6E",
        workspaceId: "wB",
        role: "doctor",
        manifestPath: "/tmp/doctor.json",
        ageMs: 500,
        stale: false,
      },
      {
        ...shared!,
        agentId: "kimi",
        paneId: "wB:p6F",
        workspaceId: "wB",
        role: "primary",
        manifestPath: "/tmp/primary.json",
        ageMs: 100,
        stale: false,
      },
    ];
    const picked = pickInvokePane("diagnose_workspace", tools);
    expect(picked?.paneId).toBe("wB:p6E");
  });

  test("pruneLatmManifests removes orphan and wrong-workspace dirs", async () => {
    await writeLatmManifest(
      buildLatmManifest({ paneId: "wB:p6E", workspaceId: "wB", role: "doctor" }),
      tmpHome
    );
    makeDir(join(tmpHome, ".config", "herdr", "agents", "w1:p99"), { recursive: true });
    await writeLatmManifest(
      buildLatmManifest({ paneId: "w1:p99", workspaceId: "w1", role: "shell" }),
      tmpHome
    );

    const { removed } = await pruneLatmManifests({
      activePaneIds: ["wB:p6E"],
      workspaceId: "wB",
      home: tmpHome,
    });
    expect(removed.some((path) => path.includes("w1:p99"))).toBe(true);
    const discovered = await discoverTools(tmpHome);
    expect(discovered.every((tool) => tool.workspaceId === "wB")).toBe(true);
  });
});
