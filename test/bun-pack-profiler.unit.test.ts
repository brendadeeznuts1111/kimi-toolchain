import { describe, expect, test } from "bun:test";
import inspector from "node:inspector/promises";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import { withTempDir } from "./helpers.ts";

function burnCpu(iterations: number): number {
  let value = 0;
  for (let i = 0; i < iterations; i++) {
    value += Math.sqrt(i % 97);
  }
  return value;
}

describe("bun-pack-profiler", () => {
  test("bun pm pack includes package.json changes made by prepack", () =>
    withTempDir("bun-pack-lifecycle-", (dir) => {
      const dist = join(dir, "dist");
      const extract = join(dir, "extract");
      makeDir(dist, { recursive: true });
      makeDir(extract, { recursive: true });

      writeText(
        join(dir, "package.json"),
        JSON.stringify(
          {
            name: "pack-lifecycle-demo",
            version: "1.0.0",
            description: "Original description",
            scripts: { prepack: "bun prepack.ts" },
            devDependencies: { "left-pad": "1.3.0" },
          },
          null,
          2
        )
      );
      writeText(
        join(dir, "prepack.ts"),
        `const pkg = await Bun.file("package.json").json() as Record<string, unknown>;
delete pkg.devDependencies;
pkg.description = "Production build";
await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\\n");
`
      );

      const pack = Bun.spawnSync({
        cmd: [
          "bun",
          "pm",
          "pack",
          "--filename",
          join(dist, "pack-lifecycle-demo.tgz"),
          "--quiet",
        ],
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const packOutput = `${new TextDecoder().decode(pack.stdout)}\n${new TextDecoder().decode(pack.stderr)}`;
      expect(pack.exitCode, packOutput).toBe(0);

      const tarball = join(dist, "pack-lifecycle-demo.tgz");
      const untar = Bun.spawnSync({
        cmd: ["tar", "-xzf", tarball, "-C", extract],
        stdout: "pipe",
        stderr: "pipe",
      });
      const untarOutput = `${new TextDecoder().decode(untar.stdout)}\n${new TextDecoder().decode(untar.stderr)}`;
      expect(untar.exitCode, untarOutput).toBe(0);

      const packedPkg = Bun.file(join(extract, "package", "package.json")).json() as Promise<{
        description?: string;
        devDependencies?: Record<string, string>;
      }>;

      return packedPkg.then((pkg) => {
        expect(pkg.description).toBe("Production build");
        expect(pkg.devDependencies).toBeUndefined();
      });
    }));

  test("node inspector Profiler API returns a CDP CPU profile", async () => {
    const session = new inspector.Session();
    session.connect();

    try {
      await session.post("Profiler.enable");
      await session.post("Profiler.setSamplingInterval", { interval: 100 });
      await session.post("Profiler.start");
      expect(burnCpu(500_000)).toBeGreaterThan(0);
      const result = (await session.post("Profiler.stop")) as {
        profile?: {
          nodes?: unknown[];
          samples?: unknown[];
          startTime?: number;
          endTime?: number;
        };
      };
      await session.post("Profiler.disable");

      expect(Array.isArray(result.profile?.nodes)).toBe(true);
      expect(result.profile?.nodes?.length).toBeGreaterThan(0);
      expect(Array.isArray(result.profile?.samples)).toBe(true);
      expect(typeof result.profile?.startTime).toBe("number");
      expect(typeof result.profile?.endTime).toBe("number");
      expect(result.profile!.endTime!).toBeGreaterThan(result.profile!.startTime!);
    } finally {
      session.disconnect();
    }
  });
});
