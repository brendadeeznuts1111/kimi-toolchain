/**
 * Runtime probes ported from oven-sh/bun `test/cli/run`, `test/cli/test`, `test/cli/env`.
 */

import { join } from "path";
import { pathExists, readText } from "./bun-io.ts";
import { cliProbe, spawnCliInDir, withCliFixture, withCliFixtureDir } from "./bun-cli-fixture.ts";
import { gateSpawnEnv, probeBunExecutable, scrubEphemeralBunNodeDirs } from "./root-hygiene.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
export interface CliContractProbeResult {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

const IF_PRESENT_PKG = JSON.stringify({
  name: "present",
  scripts: { present: "echo 'Here!'" },
});

function noTestsMessage(output: string): boolean {
  return output.includes("No tests found!") || output.includes("0 test files matching");
}

const IF_PRESENT_FILES = {
  "present.js": "console.log('Here!');",
  "package.json": IF_PRESENT_PKG,
};

function cleanCiEnv(): Record<string, string | undefined> {
  const env = { ...Bun.env };
  for (const key of [
    "GITHUB_ACTIONS",
    "GITLAB_CI",
    "CIRCLECI",
    "TRAVIS",
    "BUILDKITE",
    "JENKINS_URL",
    "BUILD_ID",
    "CI",
  ]) {
    delete env[key];
  }
  return env;
}

async function runCiInfoFixture(env: Record<string, string | undefined>) {
  const fixture = join(REPO_ROOT, "test/fixtures/ci-info.fixture.ts");
  return spawnCliInDir(REPO_ROOT, ["test", fixture], env);
}

// ── if-present ──────────────────────────────────────────────────────

export async function runIfPresentContractProbes(): Promise<CliContractProbeResult[]> {
  const probes: CliContractProbeResult[] = [];

  const errorCases: Array<[string, string[], RegExp]> = [
    ["error-script", ["notpresent"], /Script not found/],
    ["error-module", ["./notpresent.js"], /Module not found/],
    ["error-file", ["/path/to/notpresent.txt"], /Module not found/],
  ];
  for (const [suffix, args, pattern] of errorCases) {
    const { exitCode, stdout, stderr } = await withCliFixture(
      `if-present-${suffix}`,
      IF_PRESENT_FILES,
      args
    );
    probes.push(
      cliProbe(
        `cli.run.if-present.${suffix}`,
        exitCode === 1 && stdout === "" && pattern.test(stderr),
        exitCode === 1 ? "errors" : `exit=${exitCode}`
      )
    );
  }

  const okCases: Array<[string, string[]]> = [
    ["ok-script", ["--if-present", "notpresent"]],
    ["ok-module", ["--if-present", "./notpresent.js"]],
    ["ok-file", ["--if-present", "/path/to/notpresent.txt"]],
  ];
  for (const [suffix, args] of okCases) {
    const { exitCode, stdout, stderr } = await withCliFixture(
      `if-present-${suffix}`,
      IF_PRESENT_FILES,
      args
    );
    probes.push(
      cliProbe(
        `cli.run.if-present.${suffix}`,
        exitCode === 0 && stdout === "" && stderr === "",
        exitCode === 0 ? "silent ok" : `exit=${exitCode}`
      )
    );
  }

  const runScript = await withCliFixture("if-present-run-script", IF_PRESENT_FILES, [
    "run",
    "present",
  ]);
  probes.push(
    cliProbe(
      "cli.run.if-present.run-script",
      runScript.exitCode === 0 && runScript.stdout.includes("Here!"),
      runScript.exitCode === 0 ? "script" : `exit=${runScript.exitCode}`
    )
  );

  const runModule = await withCliFixture("if-present-run-module", IF_PRESENT_FILES, [
    "run",
    "present.js",
  ]);
  probes.push(
    cliProbe(
      "cli.run.if-present.run-module",
      runModule.exitCode === 0 && runModule.stdout.includes("Here!"),
      runModule.exitCode === 0 ? "module" : `exit=${runModule.exitCode}`
    )
  );

  return probes;
}

// ── run-eval (subset) ───────────────────────────────────────────────

export async function runEvalContractProbes(): Promise<CliContractProbeResult[]> {
  const probes: CliContractProbeResult[] = [];
  scrubEphemeralBunNodeDirs();
  const gateEnv = gateSpawnEnv(Bun.env);

  for (const [flag, input, expected] of [
    ["-e", 'console.log("hello world")', "hello world\n"],
    ["--print", '"hello world"', "hello world\n"],
  ] as const) {
    const proc = Bun.spawnSync({
      cmd: [probeBunExecutable(), flag, input],
      env: gateEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    probes.push(
      cliProbe(
        `cli.run.eval.${flag === "-e" ? "e" : "print"}`,
        proc.exitCode === 0 && proc.stdout.toString() === expected,
        proc.exitCode === 0 ? flag : `exit=${proc.exitCode}`
      )
    );
  }

  const evalProc = Bun.spawnSync({
    cmd: [probeBunExecutable(), "-e", "console.log(process._eval)"],
    env: gateEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  probes.push(
    cliProbe(
      "cli.run.eval.process-eval",
      evalProc.exitCode === 0 && evalProc.stdout.toString() === "console.log(process._eval)\n",
      evalProc.exitCode === 0 ? "process._eval" : `exit=${evalProc.exitCode}`
    )
  );

  const tlaProc = Bun.spawnSync({
    cmd: [probeBunExecutable(), "-p", "1 + 1"],
    env: gateEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  probes.push(
    cliProbe(
      "cli.run.eval.tla-print",
      tlaProc.exitCode === 0 && tlaProc.stdout.toString() === "2\n",
      tlaProc.exitCode === 0 ? "1+1=2" : `exit=${tlaProc.exitCode}`
    )
  );

  return probes;
}

// ── pass-with-no-tests ──────────────────────────────────────────────

export async function runPassWithNoTestsProbes(): Promise<CliContractProbeResult[]> {
  const probes: CliContractProbeResult[] = [];

  const emptyDir = { "not-a-test.ts": `console.log("hello");` };
  const okEmpty = await withCliFixture("pass-no-tests-ok", emptyDir, [
    "test",
    "--pass-with-no-tests",
  ]);
  probes.push(
    cliProbe(
      "cli.test.pass-no-tests.ok-empty",
      okEmpty.exitCode === 0 && noTestsMessage(`${okEmpty.stdout}${okEmpty.stderr}`),
      okEmpty.exitCode === 0 ? "pass empty" : `exit=${okEmpty.exitCode}`
    )
  );

  const filterDir = {
    "some.test.ts": `import { test } from "bun:test"; test("example", () => {});`,
  };
  const okFilter = await withCliFixture("pass-no-tests-filter", filterDir, [
    "test",
    "--pass-with-no-tests",
    "-t",
    "nonexistent",
  ]);
  probes.push(
    cliProbe(
      "cli.test.pass-no-tests.ok-filter",
      okFilter.exitCode === 0,
      okFilter.exitCode === 0 ? "pass filter" : `exit=${okFilter.exitCode}`
    )
  );

  const failEmpty = await withCliFixture("fail-no-tests", emptyDir, ["test"]);
  probes.push(
    cliProbe(
      "cli.test.pass-no-tests.fail-empty",
      failEmpty.exitCode === 1 && noTestsMessage(`${failEmpty.stdout}${failEmpty.stderr}`),
      failEmpty.exitCode === 1 ? "fail empty" : `exit=${failEmpty.exitCode}`
    )
  );

  const failFilter = await withCliFixture("fail-no-tests-filter", filterDir, [
    "test",
    "-t",
    "nonexistent",
  ]);
  probes.push(
    cliProbe(
      "cli.test.pass-no-tests.fail-filter",
      failFilter.exitCode === 1,
      failFilter.exitCode === 1 ? "fail filter" : `exit=${failFilter.exitCode}`
    )
  );

  const failTest = await withCliFixture(
    "pass-no-tests-fail-test",
    {
      "test.test.ts": `import { test, expect } from "bun:test"; test("failing", () => { expect(1).toBe(2); });`,
    },
    ["test", "--pass-with-no-tests"]
  );
  probes.push(
    cliProbe(
      "cli.test.pass-no-tests.fail-on-test-fail",
      failTest.exitCode === 1,
      failTest.exitCode === 1 ? "failing test" : `exit=${failTest.exitCode}`
    )
  );

  return probes;
}

// ── ci-info ─────────────────────────────────────────────────────────

export async function runCiInfoContractProbes(): Promise<CliContractProbeResult[]> {
  const base = cleanCiEnv();
  const cases: Array<[string, Record<string, string | undefined>, "allow" | "deny"]> = [
    ["allow", base, "allow"],
    ["ci-false", { ...base, CI: "false", GITHUB_ACTIONS: "true" }, "allow"],
    ["ci-true", { ...base, CI: "true" }, "deny"],
    ["ci-true-github", { ...base, CI: "true", GITHUB_ACTIONS: "true" }, "deny"],
  ];

  const probes: CliContractProbeResult[] = [];
  for (const [suffix, env, mode] of cases) {
    const { exitCode, stdout, stderr } = await runCiInfoFixture(env);
    const out = `${stdout}${stderr}`;
    const ok =
      mode === "deny"
        ? exitCode === 1 && out.includes(".only is disabled in CI environments")
        : exitCode === 0 && out.includes("1 pass");
    probes.push(cliProbe(`cli.env.ci-info.${suffix}`, ok, ok ? mode : `exit=${exitCode}`));
  }
  return probes;
}

// ── empty-file ──────────────────────────────────────────────────────

export async function runEmptyFileContractProbes(): Promise<CliContractProbeResult[]> {
  const emptyPath = join(REPO_ROOT, "test/fixtures/empty-file.js");
  const { exitCode, stdout, stderr } = await spawnCliInDir(REPO_ROOT, ["run", "--bun", emptyPath]);
  const ok = exitCode === 0 && stdout === "" && stderr === "";
  return [cliProbe("cli.run.empty-file", ok, ok ? "empty script" : `exit=${exitCode}`)];
}

// ── no-env-file ─────────────────────────────────────────────────────

function envWithoutFoo(): Record<string, string | undefined> {
  const env = { ...Bun.env };
  delete env.FOO;
  return env;
}

/** Upstream bunEnv loads .env.local / .env.development.local under development, not test. */
function envForDotenvLoading(): Record<string, string | undefined> {
  return { ...envWithoutFoo(), NODE_ENV: "development" };
}

const ENV_INDEX = "console.log(process.env.FOO);";

async function probeNoEnvPair(
  id: string,
  files: Record<string, string>,
  expectedWith: string,
  expectedWithout = "undefined"
): Promise<CliContractProbeResult> {
  const baseEnv = envForDotenvLoading();
  const loaded = await withCliFixture(`no-env-${id}-on`, files, ["index.js"], baseEnv);
  const blocked = await withCliFixture(
    `no-env-${id}-off`,
    files,
    ["--no-env-file", "index.js"],
    baseEnv
  );
  const ok =
    loaded.exitCode === 0 &&
    loaded.stdout.trim() === expectedWith &&
    blocked.exitCode === 0 &&
    blocked.stdout.trim() === expectedWithout;
  return cliProbe(`cli.run.no-envfile.${id}`, ok, ok ? expectedWith : `on=${loaded.stdout.trim()}`);
}

export async function runNoEnvFileContractProbes(): Promise<CliContractProbeResult[]> {
  const probes: CliContractProbeResult[] = [];

  probes.push(await probeNoEnvPair("dotenv", { ".env": "FOO=bar", "index.js": ENV_INDEX }, "bar"));

  probes.push(
    await probeNoEnvPair(
      "local",
      { ".env": "FOO=bar", ".env.local": "FOO=local", "index.js": ENV_INDEX },
      "local"
    )
  );

  probes.push(
    await probeNoEnvPair(
      "dev-local",
      {
        ".env": "FOO=bar",
        ".env.development.local": "FOO=dev-local",
        "index.js": ENV_INDEX,
      },
      "dev-local"
    )
  );

  const bunfigFileFalse = await withCliFixture(
    "no-env-bunfig-file-false",
    { ".env": "FOO=bar", "bunfig.toml": "[env]\nfile = false\n", "index.js": ENV_INDEX },
    ["index.js"],
    envForDotenvLoading()
  );
  probes.push(
    cliProbe(
      "cli.run.no-envfile.bunfig-file-false",
      bunfigFileFalse.exitCode === 0 && bunfigFileFalse.stdout.trim() === "undefined",
      bunfigFileFalse.stdout.trim()
    )
  );

  const bunfigEnvFalse = await withCliFixture(
    "no-env-bunfig-env-false",
    { ".env": "FOO=bar", "bunfig.toml": "env = false\n", "index.js": ENV_INDEX },
    ["index.js"],
    envForDotenvLoading()
  );
  probes.push(
    cliProbe(
      "cli.run.no-envfile.bunfig-env-false",
      bunfigEnvFalse.exitCode === 0 && bunfigEnvFalse.stdout.trim() === "undefined",
      bunfigEnvFalse.stdout.trim()
    )
  );

  const evalBlocked = await withCliFixture(
    "no-env-eval",
    { ".env": "FOO=bar" },
    ["--no-env-file", "-e", "console.log(process.env.FOO)"],
    envForDotenvLoading()
  );
  probes.push(
    cliProbe(
      "cli.run.no-envfile.eval",
      evalBlocked.exitCode === 0 && evalBlocked.stdout.trim() === "undefined",
      evalBlocked.stdout.trim()
    )
  );

  const explicit = await withCliFixture(
    "no-env-explicit",
    { ".env": "FOO=bar", ".env.custom": "FOO=custom", "index.js": ENV_INDEX },
    ["--no-env-file", "--env-file", ".env.custom", "index.js"],
    envForDotenvLoading()
  );
  probes.push(
    cliProbe(
      "cli.run.no-envfile.explicit-env-file",
      explicit.exitCode === 0 && explicit.stdout.trim() === "custom",
      explicit.stdout.trim()
    )
  );

  const bunfigTrue = await withCliFixture(
    "no-env-bunfig-true",
    { ".env": "FOO=bar", "bunfig.toml": "env = true\n", "index.js": ENV_INDEX },
    ["index.js"],
    envForDotenvLoading()
  );
  probes.push(
    cliProbe(
      "cli.run.no-envfile.bunfig-true",
      bunfigTrue.exitCode === 0 && bunfigTrue.stdout.trim() === "bar",
      bunfigTrue.stdout.trim()
    )
  );

  const production = await withCliFixture(
    "no-env-production",
    { ".env": "FOO=bar", ".env.production": "FOO=prod", "index.js": ENV_INDEX },
    ["--no-env-file", "index.js"],
    { ...envWithoutFoo(), NODE_ENV: "production" }
  );
  probes.push(
    cliProbe(
      "cli.run.no-envfile.production",
      production.exitCode === 0 && production.stdout.trim() === "undefined",
      production.stdout.trim()
    )
  );

  return probes;
}

// ── filter-workspace (expanded subset) ──────────────────────────────

const WORKSPACE_FILTER_FILES = {
  "package.json": JSON.stringify({
    name: "ws",
    workspaces: ["packages/*"],
    scripts: { present: "echo rootscript" },
  }),
  "packages/pkga/package.json": JSON.stringify({
    name: "pkga",
    scripts: { present: "echo scripta" },
  }),
  "packages/pkgb/package.json": JSON.stringify({
    name: "pkgb",
    scripts: { present: "echo scriptb" },
  }),
  "packages/dirname/package.json": JSON.stringify({
    name: "pkgc",
    scripts: { present: "echo scriptc" },
  }),
  "packages/scoped/package.json": JSON.stringify({
    name: "@scoped/scoped",
    scripts: { present: "echo scriptd" },
  }),
  "packages/malformed1/package.json": JSON.stringify({
    scripts: { present: "echo malformed1" },
  }),
  "packages/malformed2/package.json": "asdfsadfas",
  "packages/broken/package.json": "this is { not valid json",
  "packages/good/package.json": JSON.stringify({
    name: "good",
    scripts: { go: "echo ok" },
  }),
};

export async function runFilterWorkspaceContractProbes(): Promise<CliContractProbeResult[]> {
  const pkga = await withCliFixture("filter-pkga", WORKSPACE_FILTER_FILES, [
    "run",
    "--filter",
    "pkga",
    "present",
  ]);
  const star = await withCliFixture("filter-star", WORKSPACE_FILTER_FILES, [
    "run",
    "--filter",
    "*",
    "present",
  ]);
  const missing = await withCliFixture("filter-missing", WORKSPACE_FILTER_FILES, [
    "run",
    "--filter",
    "*",
    "notpresent",
  ]);
  const broken = await withCliFixture("filter-broken", WORKSPACE_FILTER_FILES, [
    "run",
    "--filter",
    "*",
    "go",
  ]);
  const scoped = await withCliFixture("filter-scoped", WORKSPACE_FILTER_FILES, [
    "run",
    "--filter",
    "@scoped/scoped",
    "present",
  ]);
  const glob = await withCliFixture("filter-glob", WORKSPACE_FILTER_FILES, [
    "run",
    "--filter",
    "./packages/*",
    "present",
  ]);
  const auto = await withCliFixture("filter-auto", WORKSPACE_FILTER_FILES, [
    "--filter",
    "./packages/pkga",
    "present",
  ]);
  const multi = await withCliFixture("filter-multi", WORKSPACE_FILTER_FILES, [
    "run",
    "--filter",
    "pkga",
    "--filter",
    "pkgb",
    "present",
  ]);
  const pkgGlob = await withCliFixture("filter-pkg-glob", WORKSPACE_FILTER_FILES, [
    "run",
    "--filter",
    "./packages/pkg*",
    "present",
  ]);
  const malformedWarn = await withCliFixture("filter-malformed-warn", WORKSPACE_FILTER_FILES, [
    "run",
    "--filter",
    "*",
    "x",
  ]);
  const exitFail = await withCliFixture(
    "filter-exit-fail",
    {
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
      "packages/dep0/package.json": JSON.stringify({
        name: "dep0",
        scripts: { script: "exit 0" },
      }),
      "packages/dep1/package.json": JSON.stringify({
        name: "dep1",
        scripts: { script: "exit 23" },
      }),
    },
    ["run", "--filter", "*", "script"]
  );

  const subdirOk = await withCliFixtureDir("filter-subdir", WORKSPACE_FILTER_FILES, async (dir) => {
    const proc = Bun.spawnSync({
      cmd: [probeBunExecutable(), "run", "--filter", "pkga", "present"],
      cwd: join(dir, "packages", "pkga"),
      env: gateSpawnEnv(Bun.env),
      stdout: "pipe",
      stderr: "pipe",
    });
    return proc.exitCode === 0 && proc.stdout.toString().includes("scripta");
  });

  const sep = process.platform === "win32" ? "\\" : "/";

  return [
    cliProbe(
      "cli.run.filter.pkga",
      pkga.exitCode === 0 && /scripta/.test(pkga.stdout),
      pkga.exitCode === 0 ? "pkga" : `exit=${pkga.exitCode}`
    ),
    cliProbe(
      "cli.run.filter.star",
      star.exitCode === 0 && /scripta/.test(star.stdout) && /scriptb/.test(star.stdout),
      star.exitCode === 0 ? "all packages" : `exit=${star.exitCode}`
    ),
    cliProbe(
      "cli.run.filter.missing-script",
      missing.exitCode !== 0 && /No packages matched/.test(missing.stderr),
      missing.exitCode !== 0 ? "missing script" : `exit=${missing.exitCode}`
    ),
    cliProbe(
      "cli.run.filter.broken-json",
      broken.exitCode === 0 &&
        broken.stdout.includes("ok") &&
        broken.stderr.includes(`broken${sep}package.json`) &&
        broken.stderr.includes("skipping this workspace package"),
      broken.exitCode === 0 ? "broken json warn" : `exit=${broken.exitCode}`
    ),
    cliProbe(
      "cli.run.filter.scoped",
      scoped.exitCode === 0 && /scriptd/.test(scoped.stdout),
      scoped.exitCode === 0 ? "scoped" : `exit=${scoped.exitCode}`
    ),
    cliProbe(
      "cli.run.filter.glob",
      glob.exitCode === 0 &&
        /scripta/.test(glob.stdout) &&
        /scriptb/.test(glob.stdout) &&
        /scriptc/.test(glob.stdout) &&
        /malformed1/.test(glob.stdout),
      glob.exitCode === 0 ? "glob" : `exit=${glob.exitCode}`
    ),
    cliProbe(
      "cli.run.filter.auto",
      auto.exitCode === 0 && /scripta/.test(auto.stdout),
      auto.exitCode === 0 ? "auto" : `exit=${auto.exitCode}`
    ),
    cliProbe(
      "cli.run.filter.multi",
      multi.exitCode === 0 && /scripta/.test(multi.stdout) && /scriptb/.test(multi.stdout),
      multi.exitCode === 0 ? "multi" : `exit=${multi.exitCode}`
    ),
    cliProbe(
      "cli.run.filter.pkg-glob",
      pkgGlob.exitCode === 0 &&
        /scripta/.test(pkgGlob.stdout) &&
        /scriptb/.test(pkgGlob.stdout) &&
        !/scriptc/.test(pkgGlob.stdout),
      pkgGlob.exitCode === 0 ? "pkg*" : `exit=${pkgGlob.exitCode}`
    ),
    cliProbe(
      "cli.run.filter.malformed-warn",
      malformedWarn.exitCode !== 0 &&
        /Failed to read/.test(malformedWarn.stderr) &&
        malformedWarn.stderr.includes("malformed2"),
      malformedWarn.exitCode !== 0 ? "malformed warn" : `exit=${malformedWarn.exitCode}`
    ),
    cliProbe(
      "cli.run.filter.exit-fail",
      exitFail.exitCode === 23 &&
        exitFail.stdout.includes("code 0") &&
        exitFail.stdout.includes("code 23"),
      exitFail.exitCode === 23 ? "exit 23" : `exit=${exitFail.exitCode}`
    ),
    cliProbe("cli.run.filter.subdir", subdirOk, subdirOk ? "subdir cwd" : "fail"),
  ];
}

// ── workspaces ──────────────────────────────────────────────────────

export async function runWorkspacesContractProbes(): Promise<CliContractProbeResult[]> {
  const baseFiles = {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    "packages/a/package.json": JSON.stringify({ name: "a", scripts: { go: "echo pack-a" } }),
    "packages/b/package.json": JSON.stringify({ name: "b", scripts: { go: "echo pack-b" } }),
  };

  const all = await withCliFixture("workspaces-all", baseFiles, ["run", "--workspaces", "go"]);
  const ifPresent = await withCliFixture(
    "workspaces-if-present",
    {
      ...baseFiles,
      "packages/c/package.json": JSON.stringify({ name: "c", scripts: {} }),
    },
    ["run", "--workspaces", "--if-present", "missing"]
  );
  const missing = await withCliFixture(
    "workspaces-missing",
    {
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "packages/a/package.json": JSON.stringify({ name: "a", scripts: {} }),
    },
    ["run", "--workspaces", "notpresent"]
  );

  return [
    cliProbe(
      "cli.run.workspaces.all",
      all.exitCode === 0 && /pack-a/.test(all.stdout) && /pack-b/.test(all.stdout),
      all.exitCode === 0 ? "all packages" : `exit=${all.exitCode}`
    ),
    cliProbe(
      "cli.run.workspaces.if-present",
      ifPresent.exitCode === 0,
      ifPresent.exitCode === 0 ? "if-present ok" : `exit=${ifPresent.exitCode}`
    ),
    cliProbe(
      "cli.run.workspaces.missing",
      missing.exitCode !== 0,
      missing.exitCode !== 0 ? "missing script" : `exit=${missing.exitCode}`
    ),
  ];
}

// ── filter-workspace dep-order / elide (subset) ─────────────────────

export async function runFilterWorkspaceExtendedProbes(): Promise<CliContractProbeResult[]> {
  const bun = probeBunExecutable();
  const depOrder = await withCliFixture(
    "filter-dep-order",
    {
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
      "packages/dep0/package.json": JSON.stringify({
        name: "dep0",
        scripts: { script: `${bun} run index.js` },
      }),
      "packages/dep0/index.js":
        'await new Promise((r) => setTimeout(r, 100)); await Bun.write("out.txt", "success");',
      "packages/dep1/package.json": JSON.stringify({
        name: "dep1",
        dependencies: { dep0: "*" },
        scripts: { script: `${bun} run index.js` },
      }),
      "packages/dep1/index.js": 'console.log(await Bun.file("../dep0/out.txt").text());',
    },
    ["run", "--filter", "*", "script"]
  );

  const prePost = await withCliFixture(
    "filter-pre-post",
    {
      "dep0/package.json": JSON.stringify({
        name: "dep0",
        scripts: {
          prescript: `${bun} run write.js`,
          script: `${bun} run readwrite.js`,
          postscript: `${bun} run read.js`,
        },
      }),
      "dep0/write.js": 'await Bun.write("out.txt", "success")',
      "dep0/readwrite.js":
        'console.log(await Bun.file("out.txt").text()); await Bun.write("post.txt", "great success")',
      "dep0/read.js": 'console.log(await Bun.file("post.txt").text())',
    },
    ["run", "--filter", "*", "script"]
  );

  const logLines = Array(20).fill("console.log('log_line');").join("\n");
  const elide = await withCliFixture(
    "filter-elide-noop",
    {
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
      "packages/dep0/package.json": JSON.stringify({
        name: "dep0",
        scripts: { script: `${bun} run index.js` },
      }),
      "packages/dep0/index.js": logLines,
    },
    ["run", "--filter", "./packages/dep0", "--elide-lines", "5", "script"],
    { NO_COLOR: "1" }
  );

  return [
    cliProbe(
      "cli.run.filter.dep-order",
      depOrder.exitCode === 0 && depOrder.stdout.includes("success"),
      depOrder.exitCode === 0 ? "dep order" : `exit=${depOrder.exitCode}`
    ),
    cliProbe(
      "cli.run.filter.pre-post",
      prePost.exitCode === 0 &&
        prePost.stdout.includes("success") &&
        prePost.stdout.includes("great success"),
      prePost.exitCode === 0 ? "pre/post" : `exit=${prePost.exitCode}`
    ),
    cliProbe(
      "cli.run.filter.elide-noop",
      elide.exitCode === 0 &&
        !elide.stdout.includes("lines elided") &&
        /(?:log_line[\s\S]*?){20}/.test(elide.stdout),
      elide.exitCode === 0 ? "elide noop" : `exit=${elide.exitCode}`
    ),
  ];
}

// ── log-test ────────────────────────────────────────────────────────

export async function runLogTestContractProbes(): Promise<CliContractProbeResult[]> {
  const quiet = await withCliFixture(
    "log-test-quiet",
    {
      ".env": "FOO=bar",
      "bunfig.toml": 'logLevel = "error"\n',
      "index.ts": "console.log('Here');",
    },
    ["index.ts"]
  );
  const defaultRun = await withCliFixture(
    "log-test-default",
    { ".env": "FOO=bar", "index.ts": "console.log('Here');" },
    ["index.ts"]
  );

  return [
    cliProbe(
      "cli.run.log-test.quiet",
      quiet.stderr === "",
      quiet.stderr === "" ? "silent" : quiet.stderr
    ),
    cliProbe(
      "cli.run.log-test.default",
      !defaultRun.stderr.includes(".env"),
      defaultRun.stderr.includes(".env") ? "logged .env" : "no .env log"
    ),
  ];
}

// ── bun init (subset) ───────────────────────────────────────────────

const INIT_ENV = gateSpawnEnv({ ...Bun.env, BUN_AGENT_RULE_DISABLED: "1" });

export async function runInitContractProbes(): Promise<CliContractProbeResult[]> {
  const probes: CliContractProbeResult[] = [];

  const worksOk = await withCliFixtureDir("init-works", {}, async (dir) => {
    const proc = Bun.spawnSync({
      cmd: [probeBunExecutable(), "init", "-y"],
      cwd: dir,
      env: INIT_ENV,
      stdout: "pipe",
      stderr: "pipe",
    });
    return (
      proc.exitCode === 0 &&
      pathExists(join(dir, "package.json")) &&
      pathExists(join(dir, "index.ts")) &&
      readText(join(dir, "package.json")).includes('"type": "module"')
    );
  });
  probes.push(cliProbe("cli.init.works", worksOk, worksOk ? "init -y" : "fail"));

  const minimalOk = await withCliFixtureDir("init-minimal", {}, async (dir) => {
    const proc = Bun.spawnSync({
      cmd: [probeBunExecutable(), "init", "--minimal", "-y"],
      cwd: dir,
      env: INIT_ENV,
      stdout: "pipe",
      stderr: "pipe",
    });
    return (
      proc.exitCode === 0 &&
      pathExists(join(dir, "package.json")) &&
      pathExists(join(dir, "tsconfig.json")) &&
      !pathExists(join(dir, "index.ts")) &&
      !pathExists(join(dir, "README.md"))
    );
  });
  probes.push(cliProbe("cli.init.minimal", minimalOk, minimalOk ? "--minimal" : "fail"));

  const noOverwrite = await withCliFixture(
    "init-no-overwrite",
    { mydir: "don't delete me!!!" },
    ["init", "-y", "mydir"],
    INIT_ENV
  );
  probes.push(
    cliProbe(
      "cli.init.no-overwrite",
      noOverwrite.exitCode !== 0,
      noOverwrite.exitCode !== 0 ? "refused overwrite" : "unexpected ok"
    )
  );

  return probes;
}

export async function runRunTestContractProbes(): Promise<CliContractProbeResult[]> {
  return [
    ...(await runIfPresentContractProbes()),
    ...(await runEvalContractProbes()),
    ...(await runPassWithNoTestsProbes()),
    ...(await runCiInfoContractProbes()),
    ...(await runEmptyFileContractProbes()),
    ...(await runNoEnvFileContractProbes()),
    ...(await runFilterWorkspaceContractProbes()),
    ...(await runFilterWorkspaceExtendedProbes()),
    ...(await runWorkspacesContractProbes()),
    ...(await runLogTestContractProbes()),
    ...(await runInitContractProbes()),
  ];
}
