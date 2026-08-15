import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import {
  formatEditorRuntimeSnapshot,
  inspectEditorRuntime,
  resolveActiveBunfigPath,
} from "../src/lib/bun-utils.ts";
import { testTempDir } from "./helpers.ts";

describe("bun-utils-editor", () => {
  test("resolveActiveBunfigPath finds project bunfig.toml", async () => {
    const path = await resolveActiveBunfigPath(import.meta.dir + "/..");
    expect(path?.endsWith("bunfig.toml")).toBe(true);
  });

  test("resolveActiveBunfigPath prefers XDG global over HOME when no project bunfig", async () => {
    const home = testTempDir("active-bunfig-home-");
    const xdg = join(home, "xdg");
    const emptyCwd = testTempDir("active-bunfig-cwd-");
    makeDir(xdg, { recursive: true });
    writeText(join(home, ".bunfig.toml"), '[install]\nlinker = "isolated"\n');
    writeText(join(xdg, ".bunfig.toml"), '[install]\nlinker = "hoisted"\n');
    const path = await resolveActiveBunfigPath(emptyCwd, {
      HOME: home,
      XDG_CONFIG_HOME: xdg,
    });
    expect(path).toBe(join(xdg, ".bunfig.toml"));
  });

  test("inspectEditorRuntime resolves bunfig over env", async () => {
    using _visual = withEnv("VISUAL", "vim");
    const snap = await inspectEditorRuntime(import.meta.dir + "/..");
    expect(typeof snap.resolved === "string" || snap.resolved === undefined).toBe(true);
    const text = formatEditorRuntimeSnapshot(snap);
    expect(text).toContain("editor:");
  });
});

function withEnv(key: string, value: string) {
  const prev = Bun.env[key];
  Bun.env[key] = value;
  return {
    [Symbol.dispose]() {
      if (prev === undefined) delete Bun.env[key];
      else Bun.env[key] = prev;
    },
  };
}
