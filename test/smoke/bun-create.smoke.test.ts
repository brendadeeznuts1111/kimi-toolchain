import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT, cleanupPath, pathExists, testTempDir } from "../helpers.ts";

const BUN_CREATE_DIR = join(REPO_ROOT, "templates", "bun-create");
const REGISTRY_PATH = join(BUN_CREATE_DIR, "templates.json");

interface TemplateEntry {
  name: string;
  type: string;
  complexity: string;
  example: string | null;
  purpose: string;
}

const registry = (await Bun.file(REGISTRY_PATH).json()) as { templates: TemplateEntry[] };

async function runBunCreate(
  template: string,
  target: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "create", template, target], {
    cwd: REPO_ROOT,
    env: { ...Bun.env, BUN_CREATE_DIR },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

describe("bun-create smoke", () => {
  test("registry has at least one template", () => {
    expect(registry.templates.length).toBeGreaterThan(0);
  });

  for (const template of registry.templates) {
    test(`${template.name} creates from BUN_CREATE_DIR with valid structure`, async () => {
      const parent = testTempDir(`bun-create-smoke-${template.name}-`);
      const target = join(parent, "my-app");

      try {
        const { stdout, stderr, exitCode } = await runBunCreate(template.name, target);
        const combined = stdout + stderr;

        expect(exitCode).toBe(0);
        expect(combined).toContain(`Created ${template.name} project successfully`);

        const pkgPath = join(target, "package.json");
        expect(await pathExists(pkgPath)).toBe(true);

        const pkg = (await Bun.file(pkgPath).json()) as {
          dependencies?: Record<string, unknown>;
          devDependencies?: Record<string, unknown>;
          scripts?: { postinstall?: string };
          "bun-create"?: { postinstall?: string | string[] };
        };

        const depCount =
          Object.keys(pkg.dependencies ?? {}).length +
          Object.keys(pkg.devDependencies ?? {}).length;
        expect(depCount).toBe(0);

        const hasPostinstall =
          typeof pkg.scripts?.postinstall === "string" ||
          typeof pkg["bun-create"]?.postinstall === "string" ||
          Array.isArray(pkg["bun-create"]?.postinstall);
        expect(hasPostinstall).toBe(true);

        expect(await pathExists(join(target, "scripts", "postinstall.ts"))).toBe(true);
      } finally {
        cleanupPath(parent);
      }
    }, 60_000);
  }
});
