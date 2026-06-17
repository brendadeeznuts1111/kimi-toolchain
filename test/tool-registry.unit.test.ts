import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "./helpers.ts";
import {
  DIRECT_BIN,
  META_BIN,
  TOOL_SHORT_NAMES,
  binNameToShortName,
  listPackageBinNames,
  resolveRepoToolScript,
  shortNameToScript,
} from "../src/lib/tool-registry.ts";

const BIN_DIR = join(REPO_ROOT, "src", "bin");

describe("tool-registry", () => {
  test("all package kimi bins dispatch through the meta registry", async () => {
    const bins = await listPackageBinNames(REPO_ROOT);
    const known = TOOL_SHORT_NAMES as readonly string[];

    for (const bin of bins) {
      if (bin === DIRECT_BIN || bin === META_BIN || !bin.startsWith("kimi-")) continue;
      const shortName = binNameToShortName(bin);
      expect(shortName).toBeTruthy();
      expect(known).toContain(shortName as string);
      expect(resolveRepoToolScript(shortName as string, BIN_DIR)).toBeTruthy();
    }
  });

  test("all registry short names except workspace resolve to scripts", () => {
    for (const shortName of TOOL_SHORT_NAMES) {
      if (shortName === "workspace") continue;
      expect(shortNameToScript(shortName)).toBeTruthy();
    }
  });
});
