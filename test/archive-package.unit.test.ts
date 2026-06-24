import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir } from "../src/lib/bun-io.ts";
import { DEFAULT_DIST_PACKAGE_OPTS, packageBuildOutput } from "../src/lib/archive-package.ts";
import { withTempDir } from "./helpers.ts";

describe("archive-package", () => {
  test("packageBuildOutput writes gzip tarball with level 9 defaults", async () => {
    await withTempDir("archive-package", async (dir) => {
      const distDir = join(dir, "dist");
      const outputPath = join(dir, "dist.tar.gz");
      await Bun.write(join(distDir, "index.js"), "console.log('ok');");
      await Bun.write(join(distDir, "assets", "logo.txt"), "logo");

      const result = await packageBuildOutput(distDir, outputPath);
      expect(result.outputPath).toBe(outputPath);
      expect(result.fileCount).toBe(2);
      expect(result.hash).toMatch(/^[0-9a-f]{8}$/);
      expect(await Bun.file(outputPath).exists()).toBe(true);
      expect(DEFAULT_DIST_PACKAGE_OPTS.level).toBe(9);
    });
  });

  test("packaged dist round-trips via Bun.Archive extract", async () => {
    await withTempDir("archive-package-rt", async (dir) => {
      const distDir = join(dir, "dist");
      const outputPath = join(dir, "dist.tar.gz");
      const extractDir = join(dir, "out");
      await Bun.write(join(distDir, "bundle.js"), "export {};\n");

      const result = await packageBuildOutput(distDir, outputPath);
      const bytes = await Bun.file(outputPath).bytes();
      makeDir(extractDir, { recursive: true });
      const archive = new Bun.Archive(bytes);
      await archive.extract(extractDir);

      expect(await Bun.file(join(extractDir, "bundle.js")).text()).toBe("export {};\n");
      expect(result.fileCount).toBe(1);
    });
  });
});
