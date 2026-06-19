import { describe, expect, test } from "bun:test";
import { join } from "path";
import { pathExists } from "../src/lib/bun-io.ts";
import { ArtifactStore } from "../src/lib/artifact-store.ts";
import { withTempDir } from "./helpers.ts";

describe("artifact-store", () => {
  test("save writes JSON under .kimi/artifacts/{gateName}/", async () => {
    await withTempDir("artifact-store-", async (dir) => {
      const store = new ArtifactStore(dir);
      const path = await store.save("bunfig-policy", { status: "pass", ok: true });

      expect(path).toContain(join(dir, ".kimi", "artifacts", "bunfig-policy"));
      expect(pathExists(path)).toBe(true);
      const text = await Bun.file(path).text();
      const parsed = JSON.parse(text) as { status: string };
      expect(parsed.status).toBe("pass");
      expect(store.relativePath(path)).toMatch(/^\.kimi\/artifacts\/bunfig-policy\//);
    });
  });
});
