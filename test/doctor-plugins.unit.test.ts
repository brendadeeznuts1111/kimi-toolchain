import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { Effect } from "effect";
import { discoverDoctorPlugins, runDoctorPluginsEffect } from "../src/lib/doctor-plugins.ts";

import { testTempDir } from "./helpers.ts";
function writeJson(path: string, data: unknown) {
  writeText(path, JSON.stringify(data, null, 2));
}

function makeDirs() {
  const tmp = testTempDir("doctor-plugins-");
  const home = join(tmp, "home");
  const project = join(tmp, "project");
  makeDir(home, { recursive: true });
  makeDir(project, { recursive: true });
  return { tmp, home, project };
}

describe("doctor-plugins", () => {
  test("discovers and runs a valid plugin", async () => {
    const { tmp, home, project } = makeDirs();
    const pluginScript = join(project, "plugin.ts");
    writeText(
      pluginScript,
      `console.log(JSON.stringify({ checks: [{ name: "my-check", status: "ok", message: "ok", fixable: false }] }));`
    );
    makeDir(join(project, ".kimi"), { recursive: true });
    writeJson(join(project, ".kimi", "doctor-plugins.json"), {
      schemaVersion: 1,
      plugins: [{ name: "my-check", command: "bun", args: ["run", pluginScript] }],
    });
    try {
      const discovered = await discoverDoctorPlugins({ projectRoot: project, home });
      expect(discovered).toHaveLength(1);
      expect("plugin" in discovered[0]!).toBe(true);
      const checks = await Effect.runPromise(
        runDoctorPluginsEffect({ projectRoot: project, home })
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.name).toBe("my-check");
      expect(checks[0]?.status).toBe("ok");
    } finally {
      removePath(tmp, { recursive: true, force: true });
    }
  });

  test("invalid plugin missing name emits error check and is not run", async () => {
    const { tmp, home, project } = makeDirs();
    makeDir(join(project, ".kimi"), { recursive: true });
    writeJson(join(project, ".kimi", "doctor-plugins.json"), {
      schemaVersion: 1,
      plugins: [{ command: "echo" }],
    });
    try {
      const discovered = await discoverDoctorPlugins({ projectRoot: project, home });
      expect(discovered).toHaveLength(1);
      expect("invalid" in discovered[0]!).toBe(true);
      const checks = await Effect.runPromise(
        runDoctorPluginsEffect({ projectRoot: project, home })
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("error");
      expect(checks[0]?.category).toBe("doctor_plugin_invalid");
      expect(checks[0]?.message).toContain("missing or empty plugin name");
    } finally {
      removePath(tmp, { recursive: true, force: true });
    }
  });

  test("plugin with command not on PATH emits invalid check", async () => {
    const { tmp, home, project } = makeDirs();
    makeDir(join(project, ".kimi"), { recursive: true });
    writeJson(join(project, ".kimi", "doctor-plugins.json"), {
      schemaVersion: 1,
      plugins: [{ name: "bad-cmd", command: "definitely-not-on-path-xyz" }],
    });
    try {
      const discovered = await discoverDoctorPlugins({ projectRoot: project, home });
      expect(discovered).toHaveLength(1);
      expect("invalid" in discovered[0]!).toBe(true);
      const checks = await Effect.runPromise(
        runDoctorPluginsEffect({ projectRoot: project, home })
      );
      expect(checks[0]?.category).toBe("doctor_plugin_invalid");
      expect(checks[0]?.message).toContain("not found on PATH");
    } finally {
      removePath(tmp, { recursive: true, force: true });
    }
  });

  test("project-local plugin overrides user-global plugin by name", async () => {
    const { tmp, home, project } = makeDirs();
    makeDir(join(home, ".kimi-code"), { recursive: true });
    makeDir(join(project, ".kimi"), { recursive: true });
    const globalScript = join(home, "global-plugin.ts");
    const localScript = join(project, "local-plugin.ts");
    writeText(
      globalScript,
      `console.log(JSON.stringify({ checks: [{ name: "shared", status: "ok", message: "global", fixable: false }] }));`
    );
    writeText(
      localScript,
      `console.log(JSON.stringify({ checks: [{ name: "shared", status: "ok", message: "local", fixable: false }] }));`
    );
    writeJson(join(home, ".kimi-code", "doctor-plugins.json"), {
      schemaVersion: 1,
      plugins: [{ name: "shared", command: "bun", args: ["run", globalScript] }],
    });
    writeJson(join(project, ".kimi", "doctor-plugins.json"), {
      schemaVersion: 1,
      plugins: [{ name: "shared", command: "bun", args: ["run", localScript] }],
    });
    try {
      const discovered = await discoverDoctorPlugins({ projectRoot: project, home });
      expect(discovered).toHaveLength(1);
      expect("plugin" in discovered[0]!).toBe(true);
      const spec = (discovered[0] as { plugin: { args: string[] } }).plugin;
      expect(spec.args?.[1]).toBe(localScript);
    } finally {
      removePath(tmp, { recursive: true, force: true });
    }
  });

  test("plugin timeout returns timeout check", async () => {
    const { tmp, home, project } = makeDirs();
    const pluginScript = join(project, "slow.ts");
    writeText(
      pluginScript,
      `await Bun.sleep(10_000); console.log(JSON.stringify({ checks: [] }));`
    );
    makeDir(join(project, ".kimi"), { recursive: true });
    writeJson(join(project, ".kimi", "doctor-plugins.json"), {
      schemaVersion: 1,
      plugins: [{ name: "slow", command: "bun", args: ["run", pluginScript], timeoutMs: 50 }],
    });
    try {
      const checks = await Effect.runPromise(
        runDoctorPluginsEffect({ projectRoot: project, home })
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("error");
      expect(checks[0]?.message).toContain("timed out after 50ms");
    } finally {
      removePath(tmp, { recursive: true, force: true });
    }
  });
});
