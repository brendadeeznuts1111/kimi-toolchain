import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Effect } from "effect";
import { discoverDoctorPlugins, runDoctorPluginsEffect } from "../src/lib/doctor-plugins.ts";

function writeJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function makeDirs() {
  const tmp = join(tmpdir(), `doctor-plugins-${Bun.randomUUIDv7()}`);
  const home = join(tmp, "home");
  const project = join(tmp, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { tmp, home, project };
}

describe("doctor-plugins", () => {
  test("discovers and runs a valid plugin", async () => {
    const { tmp, home, project } = makeDirs();
    const pluginScript = join(project, "plugin.ts");
    writeFileSync(
      pluginScript,
      `console.log(JSON.stringify({ checks: [{ name: "my-check", status: "ok", message: "ok", fixable: false }] }));`
    );
    mkdirSync(join(project, ".kimi"), { recursive: true });
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
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("invalid plugin missing name emits error check and is not run", async () => {
    const { tmp, home, project } = makeDirs();
    mkdirSync(join(project, ".kimi"), { recursive: true });
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
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("plugin with command not on PATH emits invalid check", async () => {
    const { tmp, home, project } = makeDirs();
    mkdirSync(join(project, ".kimi"), { recursive: true });
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
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("project-local plugin overrides user-global plugin by name", async () => {
    const { tmp, home, project } = makeDirs();
    mkdirSync(join(home, ".kimi-code"), { recursive: true });
    mkdirSync(join(project, ".kimi"), { recursive: true });
    const globalScript = join(home, "global-plugin.ts");
    const localScript = join(project, "local-plugin.ts");
    writeFileSync(
      globalScript,
      `console.log(JSON.stringify({ checks: [{ name: "shared", status: "ok", message: "global", fixable: false }] }));`
    );
    writeFileSync(
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
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("plugin timeout returns timeout check", async () => {
    const { tmp, home, project } = makeDirs();
    const pluginScript = join(project, "slow.ts");
    writeFileSync(
      pluginScript,
      `await Bun.sleep(10_000); console.log(JSON.stringify({ checks: [] }));`
    );
    mkdirSync(join(project, ".kimi"), { recursive: true });
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
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
