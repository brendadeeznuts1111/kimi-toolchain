/**
 * Runtime probes ported from oven-sh/bun `test/cli` contract tests.
 *
 * @see https://github.com/oven-sh/bun/tree/1bd44dbe60ff766faadb41e71a8ca67de4c72a6f/test/cli
 */

import { Glob } from "bun";
import { join } from "path";
import { makeDir, removePath, writeText } from "./bun-io.ts";
import { readableStreamToText } from "./bun-utils.ts";
import { runBunTestContractProbes } from "./bun-cli-bun-test-probes.ts";
import { runEnvContractProbes } from "./bun-cli-env-probes.ts";
import { runMarkdownEntrypointContractProbes } from "./bun-cli-markdown-probes.ts";
import { runRunTestContractProbes } from "./bun-cli-run-test-probes.ts";
import { runTestChangedContractProbes } from "./bun-cli-test-changed-probes.ts";
import { gateSpawnEnv, probeBunExecutable, scrubEphemeralBunNodeDirs } from "./root-hygiene.ts";

export interface CliContractProbeResult {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

const DEEP_OBJECT = {
  level1: {
    level2: {
      level3: {
        level4: {
          level5: {
            level6: {
              level7: {
                level8: {
                  level9: {
                    level10: "deep value",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const CONSOLE_DEPTH_SCRIPT = `console.log(${JSON.stringify(DEEP_OBJECT)});`;
const HEAP_SCRIPT = `const arr = []; for (let i = 0; i < 100; i++) arr.push({ x: i, y: "hello" + i }); console.log("done");`;

// oxlint-disable-next-line eslint/no-control-regex -- ANSI SGR sequences in NO_COLOR probes
const ANSI_RE = /\u001b\[\d+m/;

/** Normalize subprocess console output for upstream snapshot parity. */
export function normalizeConsoleOutput(output: string): string {
  return output.replace(/\r\n?/g, "\n").trim();
}

function spawnInDir(
  cwd: string,
  args: string[],
  env?: Record<string, string | undefined>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  scrubEphemeralBunNodeDirs();
  const proc = Bun.spawn({
    cmd: [probeBunExecutable(), ...args],
    cwd,
    env: gateSpawnEnv(env ? { ...Bun.env, ...env } : Bun.env),
    stdout: "pipe",
    stderr: "pipe",
  });
  return Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr }));
}

function withCliFixture(
  label: string,
  files: Record<string, string>,
  args: string[],
  env?: Record<string, string | undefined>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const dir = join(Bun.env.TMPDIR || "/tmp", `kimi-cli-${label}-${Bun.randomUUIDv7()}`);
  makeDir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const filePath = join(dir, name);
    if (body === "") {
      makeDir(filePath, { recursive: true });
    } else {
      writeText(filePath, body);
    }
  }
  return spawnInDir(dir, args, env).finally(() =>
    removePath(dir, { recursive: true, force: true })
  );
}

function probe(id: string, ok: boolean, detail: string): CliContractProbeResult {
  return { id, ok, detail };
}

// ── console-depth ───────────────────────────────────────────────────

export async function probeConsoleDepthDefault(): Promise<CliContractProbeResult> {
  const { exitCode, stdout, stderr } = await withCliFixture(
    "depth-default",
    { "test.js": CONSOLE_DEPTH_SCRIPT },
    ["test.js"]
  );
  const out = normalizeConsoleOutput(stdout);
  const ok =
    exitCode === 0 &&
    stderr === "" &&
    out.includes("level3: [Object ...]") &&
    !out.includes("level10:");
  return probe("cli.console-depth.default", ok, ok ? "default depth 2" : `exit=${exitCode}`);
}

export async function probeConsoleDepthFlag(): Promise<CliContractProbeResult> {
  const { exitCode, stdout, stderr } = await withCliFixture(
    "depth-flag",
    { "test.js": CONSOLE_DEPTH_SCRIPT },
    ["--console-depth", "3", "test.js"]
  );
  const out = normalizeConsoleOutput(stdout);
  const ok = exitCode === 0 && stderr === "" && out.includes("level4: [Object ...]");
  return probe("cli.console-depth.flag", ok, ok ? "--console-depth 3" : `exit=${exitCode}`);
}

export async function probeConsoleDepthFlagHigh(): Promise<CliContractProbeResult> {
  const { exitCode, stdout, stderr } = await withCliFixture(
    "depth-flag-high",
    { "test.js": CONSOLE_DEPTH_SCRIPT },
    ["--console-depth", "10", "test.js"]
  );
  const out = normalizeConsoleOutput(stdout);
  const ok = exitCode === 0 && stderr === "" && out.includes('level10: "deep value"');
  return probe("cli.console-depth.flag-high", ok, ok ? "--console-depth 10" : `exit=${exitCode}`);
}

export async function probeConsoleDepthInvalid(): Promise<CliContractProbeResult> {
  const { exitCode, stdout, stderr } = await withCliFixture(
    "depth-invalid",
    { "test.js": CONSOLE_DEPTH_SCRIPT },
    ["--console-depth", "invalid", "test.js"]
  );
  const all = normalizeConsoleOutput(`${stdout}${stderr}`);
  const ok = exitCode === 1 && all.includes('Invalid value for --console-depth: "invalid"');
  return probe("cli.console-depth.invalid", ok, ok ? "invalid rejected" : `exit=${exitCode}`);
}

export async function probeConsoleDepthBunfig(): Promise<CliContractProbeResult> {
  const { exitCode, stdout, stderr } = await withCliFixture(
    "depth-bunfig",
    { "test.js": CONSOLE_DEPTH_SCRIPT, "bunfig.toml": "[console]\ndepth = 4\n" },
    ["test.js"]
  );
  const out = normalizeConsoleOutput(stdout);
  const ok =
    exitCode === 0 &&
    stderr === "" &&
    out.includes("level5: [Object ...]") &&
    !out.includes("level10:");
  return probe("cli.console-depth.bunfig", ok, ok ? "bunfig depth 4" : `exit=${exitCode}`);
}

export async function probeConsoleDepthOverride(): Promise<CliContractProbeResult> {
  const { exitCode, stdout } = await withCliFixture(
    "depth-override",
    { "test.js": CONSOLE_DEPTH_SCRIPT, "bunfig.toml": "[console]\ndepth = 6\n" },
    ["--console-depth", "2", "test.js"]
  );
  const out = normalizeConsoleOutput(stdout);
  const ok = exitCode === 0 && out.includes("level3: [Object ...]");
  return probe("cli.console-depth.override", ok, ok ? "CLI overrides bunfig" : `exit=${exitCode}`);
}

export async function probeConsoleDepthZero(): Promise<CliContractProbeResult> {
  const { exitCode, stdout } = await withCliFixture(
    "depth-zero",
    { "test.js": CONSOLE_DEPTH_SCRIPT },
    ["--console-depth", "0", "test.js"]
  );
  const ok = exitCode === 0 && normalizeConsoleOutput(stdout).includes('level10: "deep value"');
  return probe("cli.console-depth.zero", ok, ok ? "depth 0 infinite" : `exit=${exitCode}`);
}

export async function probeConsoleDepthBunfigZero(): Promise<CliContractProbeResult> {
  const { exitCode, stdout } = await withCliFixture(
    "depth-bunfig-zero",
    { "test.js": CONSOLE_DEPTH_SCRIPT, "bunfig.toml": "[console]\ndepth = 0\n" },
    ["test.js"]
  );
  const ok = exitCode === 0 && normalizeConsoleOutput(stdout).includes('level10: "deep value"');
  return probe("cli.console-depth.bunfig-zero", ok, ok ? "bunfig depth 0" : `exit=${exitCode}`);
}

export async function probeConsoleDepthMulti(): Promise<CliContractProbeResult> {
  const script = `
const obj = ${JSON.stringify(DEEP_OBJECT)};
console.log("LOG:", obj);
console.error("ERROR:", obj);
console.warn("WARN:", obj);
`;
  const { exitCode, stdout, stderr } = await withCliFixture("depth-multi", { "test.js": script }, [
    "--console-depth",
    "2",
    "test.js",
  ]);
  const out = normalizeConsoleOutput(`${stdout}${stderr}`);
  const ok =
    exitCode === 0 &&
    out.includes("LOG:") &&
    out.includes("ERROR:") &&
    out.includes("WARN:") &&
    out.includes("level3: [Object ...]");
  return probe("cli.console-depth.multi", ok, ok ? "log/error/warn depth" : `exit=${exitCode}`);
}

export async function runConsoleDepthContractProbes(): Promise<CliContractProbeResult[]> {
  return [
    await probeConsoleDepthDefault(),
    await probeConsoleDepthFlag(),
    await probeConsoleDepthFlagHigh(),
    await probeConsoleDepthBunfig(),
    await probeConsoleDepthOverride(),
    await probeConsoleDepthInvalid(),
    await probeConsoleDepthZero(),
    await probeConsoleDepthBunfigZero(),
    await probeConsoleDepthMulti(),
  ];
}

// ── user-agent ──────────────────────────────────────────────────────

function userAgentScript(expected: string | null): string {
  if (expected) {
    return `
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (request.headers.get("User-Agent") === "${expected}") process.exit(0);
    process.exit(1);
  } });
try { await fetch(\`http://localhost:\${server.port}/test\`); } catch { process.exit(1); }
`;
  }
  return `
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const ua = request.headers.get("User-Agent");
    if (ua && ua.includes("Bun/")) process.exit(0);
    process.exit(1);
  } });
try { await fetch(\`http://localhost:\${server.port}/test\`); } catch { process.exit(1); }
`;
}

export async function probeUserAgentCustom(): Promise<CliContractProbeResult> {
  const { exitCode } = await withCliFixture(
    "user-agent-custom",
    { "test.js": userAgentScript("MyCustomUserAgent/1.0") },
    ["--user-agent", "MyCustomUserAgent/1.0", "test.js"]
  );
  return probe(
    "cli.user-agent.custom",
    exitCode === 0,
    exitCode === 0 ? "custom UA" : `exit=${exitCode}`
  );
}

export async function probeUserAgentDefault(): Promise<CliContractProbeResult> {
  const { exitCode } = await withCliFixture(
    "user-agent-default",
    { "test.js": userAgentScript(null) },
    ["test.js"]
  );
  return probe(
    "cli.user-agent.default",
    exitCode === 0,
    exitCode === 0 ? "default Bun/" : `exit=${exitCode}`
  );
}

export async function runUserAgentContractProbes(): Promise<CliContractProbeResult[]> {
  return [await probeUserAgentCustom(), await probeUserAgentDefault()];
}

// ── bun.test.ts ─────────────────────────────────────────────────────

export async function probeBunNoColor(): Promise<CliContractProbeResult> {
  const proc = Bun.spawnSync({
    cmd: [probeBunExecutable()],
    env: { ...Bun.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = proc.stdout.toString();
  const ok = proc.exitCode === 0 && !ANSI_RE.test(out);
  return probe("cli.bun.no-color", ok, ok ? "NO_COLOR=1 strips ANSI" : "ANSI found");
}

export async function probeBunRevision(): Promise<CliContractProbeResult> {
  const versionProc = Bun.spawnSync({
    cmd: [probeBunExecutable(), "--version"],
    stdout: "pipe",
    stderr: "pipe",
  });
  const revisionProc = Bun.spawnSync({
    cmd: [probeBunExecutable(), "--revision"],
    stdout: "pipe",
    stderr: "pipe",
  });
  const version = versionProc.stdout.toString().trim();
  const revision = revisionProc.stdout.toString().trim();
  const semver =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
  const ok = revisionProc.exitCode === 0 && revision.startsWith(version) && semver.test(revision);
  return probe("cli.bun.revision", ok, ok ? revision : `version=${version} revision=${revision}`);
}

export async function probeBunGetcompletes(): Promise<CliContractProbeResult> {
  const proc = Bun.spawnSync({
    cmd: [probeBunExecutable(), "getcompletes"],
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = proc.stdout.toString();
  const ok = proc.exitCode === 0 && out.length > 0;
  return probe("cli.bun.getcompletes", ok, ok ? "non-empty" : `exit=${proc.exitCode}`);
}

export async function probeBunGetcompletesPrePost(): Promise<CliContractProbeResult> {
  const pkg = JSON.stringify({
    name: "test",
    scripts: {
      prettier: "echo prettier",
      "prettier:fix": "echo prettier:fix",
      "prepare-release": "echo prepare-release",
      postgres: "echo postgres",
      postcss: "echo postcss",
      preview: "echo preview",
      build: "echo build",
      dev: "echo dev",
      lint: "echo lint",
      "lint:fix": "echo lint:fix",
      fix: "echo fix",
      test: "echo test",
      prebuild: "echo prebuild",
      postbuild: "echo postbuild",
      pretest: "echo pretest",
    },
  });
  const { exitCode, stdout } = await withCliFixture(
    "getcompletes-pre-post",
    { "package.json": pkg },
    ["getcompletes", "s"]
  );
  const lines = stdout
    .split("\n")
    .map((l) => l.split("\t")[0])
    .filter(Boolean);
  const ok =
    exitCode === 0 &&
    lines.includes("prettier") &&
    lines.includes("preview") &&
    !lines.includes("prebuild") &&
    !lines.includes("pretest");
  return probe(
    "cli.bun.getcompletes-pre-post",
    ok,
    ok ? "pre/post filter ok" : `lines=${lines.join(",")}`
  );
}

export async function probeBunConfig(): Promise<CliContractProbeResult> {
  const configPath = join(Bun.env.TMPDIR || "/tmp", `kimi-bunfig-${Bun.randomUUIDv7()}.toml`);
  writeText(configPath, "[debug]\n");
  try {
    const proc = Bun.spawnSync({
      cmd: [probeBunExecutable(), `--config=${configPath}`],
      env: { ...Bun.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    return probe(
      "cli.bun.config",
      proc.exitCode === 0,
      proc.exitCode === 0 ? "--config ok" : `exit=${proc.exitCode}`
    );
  } finally {
    removePath(configPath, { force: true });
  }
}

export async function runBunCliContractProbes(): Promise<CliContractProbeResult[]> {
  return [
    await probeBunNoColor(),
    await probeBunRevision(),
    await probeBunGetcompletes(),
    await probeBunGetcompletesPrePost(),
    await probeBunConfig(),
  ];
}

// ── bunfig [test] options ───────────────────────────────────────────

function extractRunningOrder(output: string): string[] {
  return [...output.matchAll(/RUNNING: (\w+)/g)].map((m) => m[1]);
}

export async function probeBunfigRandomizeSeed(): Promise<CliContractProbeResult> {
  const files = {
    "test.test.ts": `
import { test, expect } from "bun:test";
for (const name of ["alpha","bravo","charlie","delta","echo"]) {
  test(name, () => { console.log("RUNNING: " + name); expect(1).toBe(1); });
}
`,
    "bunfig.toml": "[test]\nrandomize = true\nseed = 2444615283\n",
  };
  const orders: string[][] = [];
  for (let i = 0; i < 2; i++) {
    const { exitCode, stdout, stderr } = await withCliFixture(`bunfig-rand-${i}`, files, ["test"]);
    if (exitCode !== 0) {
      return probe("cli.bunfig.randomize-seed", false, `run ${i} exit=${exitCode} ${stderr}`);
    }
    orders.push(extractRunningOrder(`${stdout}${stderr}`));
  }
  const ok =
    orders[0].length === 5 &&
    orders[1].length === 5 &&
    orders[0].join() === orders[1].join() &&
    orders[0].join() !== "alpha,bravo,charlie,delta,echo";
  return probe("cli.bunfig.randomize-seed", ok, ok ? orders[0].join(",") : "order mismatch");
}

export async function probeBunfigSeedWithoutRandomize(): Promise<CliContractProbeResult> {
  const { exitCode, stdout, stderr } = await withCliFixture(
    "bunfig-seed-only",
    {
      "test.test.ts": `import { test, expect } from "bun:test"; test("t", () => expect(1).toBe(1));`,
      "bunfig.toml": "[test]\nseed = 2444615283\n",
    },
    ["test"]
  );
  const out = `${stdout}${stderr}`;
  const ok = exitCode === 1 && out.includes("seed") && out.includes("randomize");
  return probe(
    "cli.bunfig.seed-without-randomize",
    ok,
    ok ? "seed requires randomize" : `exit=${exitCode}`
  );
}

export async function probeBunfigSeedRandomizeFalse(): Promise<CliContractProbeResult> {
  const { exitCode, stdout, stderr } = await withCliFixture(
    "bunfig-seed-false",
    {
      "test.test.ts": `import { test, expect } from "bun:test"; test("t", () => expect(1).toBe(1));`,
      "bunfig.toml": "[test]\nrandomize = false\nseed = 2444615283\n",
    },
    ["test"]
  );
  const out = `${stdout}${stderr}`;
  const ok = exitCode === 1 && out.includes("seed") && out.includes("randomize");
  return probe(
    "cli.bunfig.seed-randomize-false",
    ok,
    ok ? "seed+randomize=false errors" : `exit=${exitCode}`
  );
}

export async function probeBunfigRerunEach(): Promise<CliContractProbeResult> {
  const { exitCode, stdout, stderr } = await withCliFixture(
    "bunfig-rerun",
    {
      "test.test.ts": `
import { test, expect } from "bun:test";
let counter = 0;
test("t", () => { counter++; expect(counter).toBeGreaterThan(0); });
`,
      "bunfig.toml": "[test]\nrerunEach = 3\n",
    },
    ["test"]
  );
  const out = `${stdout}${stderr}`;
  const ok = exitCode === 0 && out.includes("3 pass");
  return probe("cli.bunfig.rerun-each", ok, ok ? "3 pass" : `exit=${exitCode}`);
}

export async function probeBunfigAllOptions(): Promise<CliContractProbeResult> {
  const { exitCode, stdout, stderr } = await withCliFixture(
    "bunfig-all",
    {
      "test.test.ts": `
import { test, expect } from "bun:test";
test("a", () => expect(1).toBe(1));
test("b", () => expect(2).toBe(2));
`,
      "bunfig.toml": "[test]\nrandomize = true\nseed = 12345\nrerunEach = 2\n",
    },
    ["test"]
  );
  const out = `${stdout}${stderr}`;
  const ok = exitCode === 0 && out.includes("4 pass");
  return probe("cli.bunfig.all-options", ok, ok ? "4 pass" : `exit=${exitCode}`);
}

export async function runBunfigTestOptionsProbes(): Promise<CliContractProbeResult[]> {
  return [
    await probeBunfigRandomizeSeed(),
    await probeBunfigSeedWithoutRandomize(),
    await probeBunfigSeedRandomizeFalse(),
    await probeBunfigRerunEach(),
    await probeBunfigAllOptions(),
  ];
}

// ── heap-prof ───────────────────────────────────────────────────────

async function heapProfFixture(
  label: string,
  args: string[],
  files: Record<string, string> = {}
): Promise<{ exitCode: number; stdout: string; stderr: string; dir: string }> {
  const dir = join(Bun.env.TMPDIR || "/tmp", `kimi-heap-${label}-${Bun.randomUUIDv7()}`);
  makeDir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const p = join(dir, name);
    if (body === "") makeDir(p, { recursive: true });
    else writeText(p, body);
  }
  const result = await spawnInDir(dir, args);
  return { ...result, dir };
}

export async function probeHeapProfV8(): Promise<CliContractProbeResult> {
  const { exitCode, stdout, stderr, dir } = await heapProfFixture("v8", [
    "--heap-prof",
    "-e",
    HEAP_SCRIPT,
  ]);
  const files = [...new Glob("Heap.*.heapsnapshot").scanSync({ cwd: dir })];
  let valid = false;
  if (files[0]) {
    try {
      const snapshot = await Bun.file(join(dir, files[0])).json();
      valid = "snapshot" in snapshot && "nodes" in snapshot;
    } catch {
      valid = false;
    }
  }
  const ok =
    exitCode === 0 &&
    stdout.trim() === "done" &&
    stderr.includes("Heap profile written to:") &&
    files.length > 0 &&
    valid;
  removePath(dir, { recursive: true, force: true });
  return probe(
    "cli.heap-prof.v8",
    ok,
    ok ? "heapsnapshot" : `exit=${exitCode} files=${files.length}`
  );
}

export async function probeHeapProfMd(): Promise<CliContractProbeResult> {
  const { exitCode, stdout, stderr, dir } = await heapProfFixture("md", [
    "--heap-prof-md",
    "-e",
    HEAP_SCRIPT,
  ]);
  const files = [...new Glob("Heap.*.md").scanSync({ cwd: dir })];
  let ok = false;
  if (files[0]) {
    const content = await Bun.file(join(dir, files[0])).text();
    ok =
      exitCode === 0 &&
      stdout.trim() === "done" &&
      stderr.includes("Heap profile written to:") &&
      content.includes("# Bun Heap Profile") &&
      content.includes("## Summary");
  }
  removePath(dir, { recursive: true, force: true });
  return probe("cli.heap-prof.md", ok, ok ? "markdown profile" : `exit=${exitCode}`);
}

export async function probeHeapProfDirV8(): Promise<CliContractProbeResult> {
  const { exitCode, stderr, dir } = await heapProfFixture(
    "dir-v8",
    ["--heap-prof", "--heap-prof-dir", "profiles", "-e", `console.log("hello");`],
    { profiles: "" }
  );
  const files = [...new Glob("Heap.*.heapsnapshot").scanSync({ cwd: join(dir, "profiles") })];
  const ok = exitCode === 0 && /profiles[/\\]/.test(stderr) && files.length > 0;
  removePath(dir, { recursive: true, force: true });
  return probe("cli.heap-prof.dir-v8", ok, ok ? "profiles dir v8" : `exit=${exitCode}`);
}

export async function probeHeapProfDirMd(): Promise<CliContractProbeResult> {
  const { exitCode, stderr, dir } = await heapProfFixture(
    "dir-md",
    ["--heap-prof-md", "--heap-prof-dir", "profiles", "-e", `console.log("hello");`],
    { profiles: "" }
  );
  const files = [...new Glob("Heap.*.md").scanSync({ cwd: join(dir, "profiles") })];
  const ok = exitCode === 0 && /profiles[/\\]/.test(stderr) && files.length > 0;
  removePath(dir, { recursive: true, force: true });
  return probe("cli.heap-prof.dir-md", ok, ok ? "profiles dir md" : `exit=${exitCode}`);
}

export async function probeHeapProfName(): Promise<CliContractProbeResult> {
  const { exitCode, stderr, dir } = await heapProfFixture("name", [
    "--heap-prof",
    "--heap-prof-name",
    "my-profile.heapsnapshot",
    "-e",
    `console.log("hello");`,
  ]);
  const size = await Bun.file(join(dir, "my-profile.heapsnapshot")).exists();
  const ok = exitCode === 0 && stderr.includes("my-profile.heapsnapshot") && size;
  removePath(dir, { recursive: true, force: true });
  return probe("cli.heap-prof.name", ok, ok ? "named snapshot" : `exit=${exitCode}`);
}

export async function probeHeapProfNameDir(): Promise<CliContractProbeResult> {
  const { exitCode, dir } = await heapProfFixture(
    "name-dir",
    [
      "--heap-prof",
      "--heap-prof-dir",
      "output",
      "--heap-prof-name",
      "custom.heapsnapshot",
      "-e",
      `console.log("hello");`,
    ],
    { output: "" }
  );
  const size = await Bun.file(join(dir, "output", "custom.heapsnapshot")).exists();
  const ok = exitCode === 0 && size;
  removePath(dir, { recursive: true, force: true });
  return probe("cli.heap-prof.name-dir", ok, ok ? "name+dir" : `exit=${exitCode}`);
}

export async function probeHeapProfNameWarn(): Promise<CliContractProbeResult> {
  const { exitCode, stdout, stderr, dir } = await heapProfFixture("warn", [
    "--heap-prof-name",
    "test.heapsnapshot",
    "-e",
    `console.log("hello");`,
  ]);
  const files = [...new Glob("*.heap*").scanSync({ cwd: dir })];
  const ok =
    exitCode === 0 &&
    stdout.trim() === "hello" &&
    stderr.includes("--heap-prof-name requires --heap-prof or --heap-prof-md") &&
    files.length === 0;
  removePath(dir, { recursive: true, force: true });
  return probe("cli.heap-prof.name-warn", ok, ok ? "warn without prof" : `exit=${exitCode}`);
}

export async function runHeapProfContractProbes(): Promise<CliContractProbeResult[]> {
  return [
    await probeHeapProfV8(),
    await probeHeapProfMd(),
    await probeHeapProfDirV8(),
    await probeHeapProfDirMd(),
    await probeHeapProfName(),
    await probeHeapProfNameDir(),
    await probeHeapProfNameWarn(),
  ];
}

// ── BUN_OPTIONS ─────────────────────────────────────────────────────

function bunOptionsEnv(value: string): Record<string, string | undefined> {
  return { ...Bun.env, BUN_OPTIONS: value };
}

export async function probeBunOptionsBasic(): Promise<CliContractProbeResult> {
  const proc = Bun.spawnSync({
    cmd: [probeBunExecutable()],
    env: bunOptionsEnv("--print='BUN_OPTIONS WAS A SUCCESS'"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const ok = proc.exitCode === 0 && proc.stdout.toString().includes("BUN_OPTIONS WAS A SUCCESS");
  return probe("cli.bun-options.basic", ok, ok ? "basic" : `exit=${proc.exitCode}`);
}

export async function probeBunOptionsMultiple(): Promise<CliContractProbeResult> {
  const proc = Bun.spawnSync({
    cmd: [probeBunExecutable()],
    env: bunOptionsEnv("--print='MULTIPLE OPTIONS' --quiet"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const ok = proc.exitCode === 0 && proc.stdout.toString().includes("MULTIPLE OPTIONS");
  return probe("cli.bun-options.multiple", ok, ok ? "multiple" : `exit=${proc.exitCode}`);
}

export async function probeBunOptionsQuotes(): Promise<CliContractProbeResult> {
  const proc = Bun.spawnSync({
    cmd: [probeBunExecutable()],
    env: bunOptionsEnv('--print="QUOTED OPTIONS"'),
    stdout: "pipe",
    stderr: "pipe",
  });
  const ok = proc.exitCode === 0 && proc.stdout.toString().includes("QUOTED OPTIONS");
  return probe("cli.bun-options.quotes", ok, ok ? "quotes" : `exit=${proc.exitCode}`);
}

export async function probeBunOptionsPriority(): Promise<CliContractProbeResult> {
  const proc = Bun.spawnSync({
    cmd: [probeBunExecutable(), "--print='COMMAND LINE'"],
    env: bunOptionsEnv("--quiet"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const ok = proc.exitCode === 0 && proc.stdout.toString().includes("COMMAND LINE");
  return probe("cli.bun-options.priority", ok, ok ? "CLI wins" : `exit=${proc.exitCode}`);
}

export async function probeBunOptionsCpuProf(): Promise<CliContractProbeResult> {
  const dir = join(Bun.env.TMPDIR || "/tmp", `kimi-cpu-prof-${Bun.randomUUIDv7()}`);
  makeDir(dir, { recursive: true });
  try {
    const proc = Bun.spawnSync({
      cmd: [probeBunExecutable(), "-e", "1"],
      env: bunOptionsEnv(`--cpu-prof --cpu-prof-dir=${dir}`),
      stdout: "pipe",
      stderr: "pipe",
    });
    const files = [...new Glob("*.cpuprofile").scanSync({ cwd: dir })];
    const ok = proc.exitCode === 0 && files.length >= 1;
    return probe("cli.bun-options.cpu-prof", ok, ok ? "cpuprofile" : `exit=${proc.exitCode}`);
  } finally {
    removePath(dir, { recursive: true, force: true });
  }
}

export async function probeBunOptionsEmpty(): Promise<CliContractProbeResult> {
  const proc = Bun.spawnSync({
    cmd: [probeBunExecutable(), "--print='NORMAL'"],
    env: bunOptionsEnv(""),
    stdout: "pipe",
    stderr: "pipe",
  });
  const ok = proc.exitCode === 0 && proc.stdout.toString().includes("NORMAL");
  return probe("cli.bun-options.empty", ok, ok ? "empty ok" : `exit=${proc.exitCode}`);
}

export async function probeBunOptionsCpuProfCompile(): Promise<CliContractProbeResult> {
  const dir = join(Bun.env.TMPDIR || "/tmp", `kimi-compile-${Bun.randomUUIDv7()}`);
  makeDir(dir, { recursive: true });
  try {
    writeText(join(dir, "entry.ts"), "console.log('ok');");
    const exePath = join(dir, "app");
    const profDir = join(dir, "profiles");
    makeDir(profDir, { recursive: true });

    // Compile standalone executable
    const build = Bun.spawnSync({
      cmd: [
        probeBunExecutable(),
        "build",
        "--compile",
        join(dir, "entry.ts"),
        "--outfile",
        exePath,
      ],
      env: Bun.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (build.exitCode !== 0) {
      return probe("cli.bun-options.compile", false, `build failed exit=${build.exitCode}`);
    }

    // Run with BUN_OPTIONS
    const result = Bun.spawnSync({
      cmd: [exePath],
      env: bunOptionsEnv(`--cpu-prof --cpu-prof-dir=${profDir}`),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      return probe("cli.bun-options.compile", false, `run failed exit=${result.exitCode}`);
    }

    const files = [...new Glob("*.cpuprofile").scanSync({ cwd: profDir })];
    const ok = result.stdout.toString().includes("ok") && files.length >= 1;
    return probe("cli.bun-options.compile", ok, ok ? "standalone BUN_OPTIONS" : "no cpuprofile");
  } finally {
    removePath(dir, { recursive: true, force: true });
  }
}

export async function runBunOptionsContractProbes(): Promise<CliContractProbeResult[]> {
  return [
    await probeBunOptionsBasic(),
    await probeBunOptionsMultiple(),
    await probeBunOptionsQuotes(),
    await probeBunOptionsPriority(),
    await probeBunOptionsCpuProf(),
    await probeBunOptionsEmpty(),
    // compile probe is smoke-tier only (bun build --compile ~60s upstream harness)
  ];
}

// ── aggregate ───────────────────────────────────────────────────────

export async function runAllCliContractProbes(): Promise<CliContractProbeResult[]> {
  return [
    ...(await runConsoleDepthContractProbes()),
    ...(await runUserAgentContractProbes()),
    ...(await runBunCliContractProbes()),
    ...(await runBunfigTestOptionsProbes()),
    ...(await runHeapProfContractProbes()),
    ...(await runBunOptionsContractProbes()),
    ...(await runRunTestContractProbes()),
    ...(await runEnvContractProbes()),
    ...(await runBunTestContractProbes()),
    ...(await runTestChangedContractProbes()),
    ...(await runMarkdownEntrypointContractProbes()),
  ];
}
