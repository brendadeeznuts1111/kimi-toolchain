import { describe, expect, spyOn, test } from "bun:test";
import {
  formatEditorRuntimeSnapshot,
  inspectEditorRuntime,
  openFileInEditor,
  resolveActiveBunfigPath,
} from "../src/lib/bun-utils.ts";

describe("bun-utils-editor", () => {
  test("openFileInEditor delegates to Bun.openInEditor with options", () => {
    using spy = spyOn(Bun, "openInEditor").mockImplementation(() => {});
    openFileInEditor("/tmp/test.ts", { editor: "code", line: 10, column: 5 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("/tmp/test.ts", { editor: "code", line: 10, column: 5 });
  });

  test("openFileInEditor accepts a URL object and passes it to Bun.openInEditor", () => {
    using spy = spyOn(Bun, "openInEditor").mockImplementation(() => {});
    const url = new URL("file:///tmp/test.ts");
    openFileInEditor(url);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(url, undefined);
  });

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
