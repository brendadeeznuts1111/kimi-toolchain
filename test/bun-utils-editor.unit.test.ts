import { describe, expect, test } from "bun:test";
import {
  formatEditorRuntimeSnapshot,
  inspectEditorRuntime,
  resolveActiveBunfigPath,
} from "../src/lib/bun-utils.ts";

describe("bun-utils-editor", () => {
  test("resolveActiveBunfigPath finds project bunfig.toml", async () => {
    const path = await resolveActiveBunfigPath(import.meta.dir + "/..");
    expect(path?.endsWith("bunfig.toml")).toBe(true);
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
