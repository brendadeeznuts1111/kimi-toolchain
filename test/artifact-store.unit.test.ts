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

  test("list returns chronological relative paths", async () => {
    await withTempDir("artifact-store-list-", async (dir) => {
      const store = new ArtifactStore(dir);
      await store.save("perf-gate", { n: 1 });
      await Bun.sleep(2);
      await store.save("perf-gate", { n: 2 });

      const files = await store.list("perf-gate");
      expect(files).toHaveLength(2);
      expect(files[0]).toMatch(/^\.kimi\/artifacts\/perf-gate\//);
      expect(files[1]).toMatch(/^\.kimi\/artifacts\/perf-gate\//);
    });
  });

  test("listGates returns gate directories with saved artifacts", async () => {
    await withTempDir("artifact-store-gates-", async (dir) => {
      const store = new ArtifactStore(dir);
      expect(await store.listGates()).toEqual([]);

      await store.save("bunfig-policy", { n: 1 });
      await store.save("card-probe", { n: 2 });

      expect(await store.listGates()).toEqual(["bunfig-policy", "card-probe"]);
    });
  });

  test("getLatest returns newest payload", async () => {
    await withTempDir("artifact-store-latest-", async (dir) => {
      const store = new ArtifactStore(dir);
      await store.save("card-probe", { n: 1 });
      await Bun.sleep(2);
      await store.save("card-probe", { n: 2 });

      const latest = await store.getLatest("card-probe");
      expect(latest).not.toBeNull();
      expect((latest!.payload as { n: number }).n).toBe(2);
      expect(latest!.relativePath).toContain(".kimi/artifacts/card-probe/");
    });
  });
});
