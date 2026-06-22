import { describe, expect, spyOn, test } from "bun:test";
import { openFileInEditor } from "../src/lib/bun-utils.ts";

describe("bun-utils-editor", () => {
  test("openFileInEditor delegates to Bun.openInEditor with options", () => {
    using spy = spyOn(Bun, "openInEditor").mockImplementation(() => {});
    openFileInEditor("/tmp/test.ts", { editor: "code", line: 10, column: 5 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("/tmp/test.ts", { editor: "code", line: 10, column: 5 });
  });

  test("openFileInEditor works with URL input", () => {
    using spy = spyOn(Bun, "openInEditor").mockImplementation(() => {});
    const url = new URL("file:///tmp/test.ts");
    openFileInEditor(url);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(url, undefined);
  });
});
