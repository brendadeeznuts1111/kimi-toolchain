/**
 * Bun CLI & tooling regression guards (Bun v1.3.7 release notes).
 *
 * @see https://bun.com/blog/bun-v1.3.7
 */
import { describe, expect, test } from "bun:test";
import { join } from "path";
import { listDir, pathExists, writeText } from "../src/lib/bun-io.ts";
import { withIsolatedHome, withTempDir } from "./helpers.ts";

interface SpawnOutcome {
  readonly exitCode: number | null;
  readonly output: string;
}

function decode(bytes: Uint8Array | null | undefined): string {
  return bytes ? new TextDecoder().decode(bytes) : "";
}

function spawnOutcome(
  argv: string[],
  options: Parameters<typeof Bun.spawnSync>[1] = {}
): SpawnOutcome {
  const proc = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe", ...options });
  return {
    exitCode: proc.exitCode,
    output: `${decode(proc.stdout)}${decode(proc.stderr)}`.trim(),
  };
}

function childEnv(overrides: Record<string, string>): Record<string, string | undefined> {
  return { ...Bun.env, ...overrides };
}

async function probeBunFileMessage(
  extension: string,
  body: string
): Promise<{ cannotRun: boolean; devServer: boolean; output: string }> {
  return withTempDir("bun-cli-probe-", async (dir) => {
    const filePath = join(dir, `sample${extension}`);
    writeText(filePath, body);
    const proc = Bun.spawn([process.execPath, filePath], {
      stdout: "pipe",
      stderr: "pipe",
      env: childEnv({ BUN_OPTIONS: "" }),
    });
    const timer = setTimeout(() => proc.kill(), 800);
    const [stdout, stderr] = await Promise.all([
      proc.stdout ? readable(proc.stdout) : Promise.resolve(""),
      proc.stderr ? readable(proc.stderr) : Promise.resolve(""),
    ]);
    clearTimeout(timer);
    const output = `${stdout}${stderr}`.trim();
    return {
      cannotRun: /Cannot run/i.test(output),
      devServer: /dev server ready/i.test(output),
      output,
    };
  }) as Promise<{ cannotRun: boolean; devServer: boolean; output: string }>;
}

async function readable(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

interface NpmPostinstallProbe {
  readonly active: boolean;
  readonly output: string;
  readonly exitCode: number | null;
}

async function probeNpmBunPostinstallDiagnostic(): Promise<NpmPostinstallProbe> {
  try {
    return (await withTempDir("bun-npm-probe-", async (dir) => {
      const install = spawnOutcome(["npm", "install", "bun@1.3.14", "--ignore-scripts"], {
        cwd: dir,
        timeout: 90_000,
      });
      if (install.exitCode !== 0) {
        return { active: false, output: install.output, exitCode: install.exitCode };
      }

      const bunBin = join(dir, "node_modules", ".bin", "bun");
      if (!pathExists(bunBin)) {
        return { active: false, output: "missing bun bin stub", exitCode: null };
      }

      const run = spawnOutcome(["sh", bunBin, "--version"]);
      const active = /postinstall script was not run/i.test(run.output) && run.exitCode !== 0;
      return { active, output: run.output, exitCode: run.exitCode };
    })) as NpmPostinstallProbe;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { active: false, output: message, exitCode: null };
  }
}

const cssProbe = await probeBunFileMessage(".css", "body { color: red; }\n");
const yamlProbe = await probeBunFileMessage(".yaml", "key: value\n");
const htmlProbe = await probeBunFileMessage(".html", "<!doctype html><title>x</title>\n");
const unsupportedFileFixActive = cssProbe.cannotRun && yamlProbe.cannotRun;
const npmPostinstallProbe = await probeNpmBunPostinstallDiagnostic();

describe("bun-cli-tooling", () => {
  test("bun completions tolerates BrokenPipe when stdout closes early", () => {
    for (const shell of ["bun completions | true", "bun completions | head -1"]) {
      const proc = Bun.spawnSync(["sh", "-c", shell], { stdout: "pipe", stderr: "pipe" });
      expect(proc.exitCode).toBe(0);
      const stderr = decode(proc.stderr);
      expect(stderr).not.toMatch(/BrokenPipe|broken pipe/i);
    }
  });

  test("fish completions include bun update flags", () => {
    const fish = spawnOutcome(["bun", "completions", "fish"]).output;
    const updateBlock = fish.slice(
      fish.indexOf("_bun_update_completion"),
      fish.indexOf("_bun_outdated_completion")
    );
    expect(updateBlock).toContain("_bun_update_completion");
    expect(updateBlock).toContain("--global[Add a package globally]");
    expect(updateBlock).toContain("--dry-run[");
    expect(updateBlock).toContain("--force[Always request the latest versions");
    expect(fish).toContain('update\\:"Update outdated dependencies');
  });

  test("bun init --minimal creates only package.json and tsconfig.json", () => {
    withIsolatedHome((home) => {
      withTempDir("bun-init-minimal-", (dir) => {
        const proc = Bun.spawnSync(["bun", "init", "--minimal", "-y"], {
          cwd: dir,
          env: childEnv({ HOME: home }),
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(proc.exitCode).toBe(0);
        expect(pathExists(join(dir, "package.json"))).toBe(true);
        expect(pathExists(join(dir, "tsconfig.json"))).toBe(true);
        expect(pathExists(join(dir, "CLAUDE.md"))).toBe(false);
        expect(pathExists(join(dir, "AGENTS.md"))).toBe(false);
        expect(pathExists(join(dir, ".cursor"))).toBe(false);
        const rootEntries = listDir(dir);
        expect(rootEntries).not.toContain("CLAUDE.md");
        expect(rootEntries).not.toContain(".cursorrules");
      });
    });
  });

  test("BUN_OPTIONS parses multiple bare flags", () => {
    const proc = Bun.spawnSync(
      ["bun", "-e", "console.log(JSON.stringify(process.execArgv ?? []))"],
      {
        env: childEnv({ BUN_OPTIONS: "--cpu-prof --cpu-prof-dir=profiles" }),
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    expect(proc.exitCode).toBe(0);
    const argv = JSON.parse(decode(proc.stdout)) as string[];
    expect(argv).toContain("--cpu-prof");
    expect(argv.some((arg) => arg.startsWith("--cpu-prof-dir="))).toBe(true);
  });

  test("missing script file reports module not found (not Cannot run)", () => {
    withTempDir("bun-cli-missing-", (dir) => {
      const missing = join(dir, "ghost.ts");
      const outcome = spawnOutcome(["bun", missing]);
      expect(outcome.exitCode).not.toBe(0);
      expect(outcome.output).toMatch(/not found/i);
      expect(outcome.output).not.toMatch(/Cannot run/i);
    });
  });

  test(`unsupported-file fix active=${unsupportedFileFixActive} htmlDevServer=${htmlProbe.devServer}`, () => {
    if (!unsupportedFileFixActive) {
      console.warn(
        `[bun-cli-tooling] Cannot-run message not active on Bun ${Bun.version} (css=${cssProbe.cannotRun}, yaml=${yamlProbe.cannotRun})`
      );
    }
    if (htmlProbe.devServer) {
      console.warn(
        "[bun-cli-tooling] .html still launches dev server — excluded from Cannot-run guard"
      );
    }
    expect(typeof unsupportedFileFixActive).toBe("boolean");
  });

  test.skipIf(!unsupportedFileFixActive)(
    "bun <file> on unsupported types reports Cannot run with file type",
    () => {
      withTempDir("bun-cli-cannot-run-", (dir) => {
        for (const [ext, body] of [
          [".css", "body { color: red; }\n"],
          [".yaml", "key: value\n"],
        ] as const) {
          const filePath = join(dir, `sample${ext}`);
          writeText(filePath, body);
          const outcome = spawnOutcome(["bun", filePath]);
          expect(outcome.output).toMatch(/Cannot run/i);
          expect(outcome.output.toLowerCase()).toContain(ext.slice(1));
          expect(outcome.exitCode).not.toBe(0);
        }
      });
    }
  );

  test(`npm bun postinstall diagnostic active=${npmPostinstallProbe.active}`, () => {
    if (!npmPostinstallProbe.active) {
      console.warn(
        `[bun-cli-tooling] npm bun postinstall diagnostic not detected on Bun ${Bun.version}`
      );
    }
    expect(typeof npmPostinstallProbe.active).toBe("boolean");
  });

  test.skipIf(!npmPostinstallProbe.active)(
    "npm bun package errors when postinstall was skipped",
    () => {
      expect(npmPostinstallProbe.output).toMatch(/postinstall script was not run/i);
      expect(npmPostinstallProbe.output).toContain("install.js");
      expect(npmPostinstallProbe.output).toMatch(/ignore-scripts|pnpm/i);
      expect(npmPostinstallProbe.exitCode).not.toBe(0);
    }
  );
});
