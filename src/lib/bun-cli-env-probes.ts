/**
 * Runtime probes ported from oven-sh/bun `test/cli/run/env.test.ts` (subset).
 */

import { cliProbe, withCliFixture } from "./bun-cli-fixture.ts";

export interface CliContractProbeResult {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

function dotenvRunEnv(
  extra?: Record<string, string | undefined>
): Record<string, string | undefined> {
  const env = { ...Bun.env };
  for (const key of [
    "NODE_ENV",
    "FOO",
    "BAR",
    "LOCAL",
    "BUNTEST_A",
    "BUNTEST_B",
    "BUNTEST_PROCESS",
    "BUNTEST_DOTENV",
    "YOLO",
    "export",
  ]) {
    delete env[key];
  }
  return { ...env, NODE_ENV: "development", ...extra };
}

const ENV_INDEX_FOO = "console.log(process.env.FOO);";
const ENV_INDEX_MULTI = "console.log(process.env.FOO, process.env.BAR);";
const BUNTEST_INDEX =
  "console.log(Object.entries(process.env).flatMap(([k,v]) => k.startsWith('BUNTEST_') ? [`${k}=${v}`] : []).sort().join(','));";

export async function runEnvContractProbes(): Promise<CliContractProbeResult[]> {
  const probes: CliContractProbeResult[] = [];
  const base = dotenvRunEnv();

  const dotenv = await withCliFixture(
    "env-dotenv",
    { ".env": "FOO=bar\n", "index.ts": ENV_INDEX_FOO },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.dotenv",
      dotenv.exitCode === 0 && dotenv.stdout.trim() === "bar",
      dotenv.stdout.trim()
    )
  );

  const local = await withCliFixture(
    "env-local",
    {
      ".env": "FOO=fail\nBAR=baz\n",
      ".env.local": "FOO=bar\n",
      "index.ts": ENV_INDEX_MULTI,
    },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.local",
      local.exitCode === 0 && local.stdout.trim() === "bar baz",
      local.stdout.trim()
    )
  );

  const development = await withCliFixture(
    "env-development",
    {
      ".env": "FOO=fail\nBAR=baz\n",
      ".env.development": "FOO=bar\n",
      ".env.local": "LOCAL=true\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR, process.env.LOCAL);",
    },
    ["index.ts"],
    dotenvRunEnv({ NODE_ENV: "development" })
  );
  probes.push(
    cliProbe(
      "cli.run.env.development",
      development.exitCode === 0 && development.stdout.trim() === "bar baz true",
      development.stdout.trim()
    )
  );

  const production = await withCliFixture(
    "env-production",
    {
      ".env": "FOO=fail\nBAR=baz\n",
      ".env.production": "FOO=bar\n",
      ".env.local": "LOCAL=true\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR, process.env.LOCAL);",
    },
    ["index.ts"],
    dotenvRunEnv({ NODE_ENV: "production" })
  );
  probes.push(
    cliProbe(
      "cli.run.env.production",
      production.exitCode === 0 && production.stdout.trim() === "bar baz true",
      production.stdout.trim()
    )
  );

  const override = await withCliFixture(
    "env-override",
    { ".env": "FOO=.env\n", "index.ts": ENV_INDEX_FOO },
    ["index.ts"],
    dotenvRunEnv({ FOO: "override" })
  );
  probes.push(
    cliProbe(
      "cli.run.env.process-override",
      override.exitCode === 0 && override.stdout.trim() === "override",
      override.stdout.trim()
    )
  );

  const colon = await withCliFixture(
    "env-colon",
    { ".env": "FOO: foo", "index.ts": ENV_INDEX_FOO },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.colon",
      colon.exitCode === 0 && colon.stdout.trim() === "foo",
      colon.stdout.trim()
    )
  );

  const exportAssign = await withCliFixture(
    "env-export",
    {
      ".env": "export FOO = foo\nexport = bar",
      "index.ts": "console.log(process.env.FOO, process.env.export);",
    },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.export",
      exportAssign.exitCode === 0 && exportAssign.stdout.trim() === "foo bar",
      exportAssign.stdout.trim()
    )
  );

  const expand = await withCliFixture(
    "env-expand",
    {
      ".env": "FOO=foo\nBAR=$FOO bar\nMOO=${FOO} ${BAR:-fail} ${MOZ:-moo}",
      "index.ts": "console.log([process.env.FOO, process.env.BAR, process.env.MOO].join('|'));",
    },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.expand",
      expand.exitCode === 0 && expand.stdout.trim() === "foo|foo bar|foo foo bar moo",
      expand.stdout.trim()
    )
  );

  const envFileSingle = await withCliFixture(
    "env-file-single",
    { ".env.a": "BUNTEST_A=1", "index.ts": BUNTEST_INDEX },
    ["--env-file", ".env.a", "index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.env-file-single",
      envFileSingle.exitCode === 0 && envFileSingle.stdout.trim() === "BUNTEST_A=1",
      envFileSingle.stdout.trim()
    )
  );

  const envFileMulti = await withCliFixture(
    "env-file-multi",
    { ".env.a": "BUNTEST_A=1", ".env.b": "BUNTEST_B=1", "index.ts": BUNTEST_INDEX },
    ["--env-file", ".env.a", "--env-file=.env.b", "index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.env-file-multi",
      envFileMulti.exitCode === 0 && envFileMulti.stdout.trim() === "BUNTEST_A=1,BUNTEST_B=1",
      envFileMulti.stdout.trim()
    )
  );

  const nodeEnvTest = await withCliFixture(
    "env-node-env-test",
    {
      "index.test.ts":
        "import { test } from 'bun:test'; test('t', () => { console.log(process.env.NODE_ENV); });",
    },
    ["test", "index.test.ts"],
    { ...Bun.env }
  );
  const testOut = `${nodeEnvTest.stdout}${nodeEnvTest.stderr}`;
  probes.push(
    cliProbe(
      "cli.run.env.node-env-test",
      nodeEnvTest.exitCode === 0 && testOut.includes("test"),
      nodeEnvTest.exitCode === 0 ? "NODE_ENV=test" : `exit=${nodeEnvTest.exitCode}`
    )
  );

  const comments = await withCliFixture(
    "env-comments",
    {
      ".env": "#FOZ\nFOO = foo#FAIL\nBAR='bar' #BAZ",
      "index.ts": "console.log(process.env.FOO, process.env.BAR);",
    },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.comments",
      comments.exitCode === 0 && comments.stdout.trim() === "foo bar",
      comments.stdout.trim()
    )
  );

  const escapedDollar = await withCliFixture(
    "env-dollar",
    {
      ".env": "FOO=foo\nBAR=\\$FOO",
      "index.ts": "console.log(process.env.FOO, process.env.BAR);",
    },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.escaped-dollar",
      escapedDollar.exitCode === 0 && escapedDollar.stdout.trim() === "foo $FOO",
      escapedDollar.stdout.trim()
    )
  );

  const envFilePriority = await withCliFixture(
    "env-file-priority",
    { ".env.a": "BUNTEST_A=1", ".env.a2": "BUNTEST_A=2", "index.ts": BUNTEST_INDEX },
    ["--env-file", ".env.a,.env.a2", "index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.env-file-priority",
      envFilePriority.exitCode === 0 && envFilePriority.stdout.trim() === "BUNTEST_A=2",
      envFilePriority.stdout.trim()
    )
  );

  const envFileProcess = await withCliFixture(
    "env-file-process",
    { ".env.a": "BUNTEST_A=1", ".env.b": "BUNTEST_B=1", "index.ts": BUNTEST_INDEX },
    ["--env-file=.env.a", "--env-file=.env.b", "index.ts"],
    dotenvRunEnv({ BUNTEST_PROCESS: "P", BUNTEST_A: "P" })
  );
  probes.push(
    cliProbe(
      "cli.run.env.env-file-process",
      envFileProcess.exitCode === 0 &&
        envFileProcess.stdout.trim() === "BUNTEST_A=P,BUNTEST_B=1,BUNTEST_PROCESS=P",
      envFileProcess.stdout.trim()
    )
  );

  const envFileEmpty = await withCliFixture(
    "env-file-empty",
    { ".env": "BUNTEST_DOTENV=1", "index.ts": BUNTEST_INDEX },
    ["--env-file=''", "index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.env-file-empty",
      envFileEmpty.exitCode === 0 && envFileEmpty.stdout.trim() === "",
      envFileEmpty.stdout.trim() === "" ? "disabled" : envFileEmpty.stdout.trim()
    )
  );

  const localOverrides = await withCliFixture(
    "env-local-overrides",
    {
      ".env": "FOO=.env\n",
      ".env.development": "FOO=.env.development\n",
      ".env.local": "FOO=.env.local\n",
      "index.ts": ENV_INDEX_FOO,
    },
    ["index.ts"],
    dotenvRunEnv({ NODE_ENV: "development" })
  );
  probes.push(
    cliProbe(
      "cli.run.env.local-overrides-env",
      localOverrides.exitCode === 0 && localOverrides.stdout.trim() === ".env.local",
      localOverrides.stdout.trim()
    )
  );

  const localEnvLocal = await withCliFixture(
    "env-dev-local-overrides",
    {
      ".env": "FOO=.env\n",
      ".env.development": "FOO=.env.development\n",
      ".env.development.local": "FOO=.env.development.local\n",
      ".env.local": "FOO=.env.local\n",
      "index.ts": ENV_INDEX_FOO,
    },
    ["index.ts"],
    dotenvRunEnv({ NODE_ENV: "development" })
  );
  probes.push(
    cliProbe(
      "cli.run.env.dev-local-overrides",
      localEnvLocal.exitCode === 0 && localEnvLocal.stdout.trim() === ".env.development.local",
      localEnvLocal.stdout.trim()
    )
  );

  const pe = ["process", "env"].join(".");
  const inlining = await withCliFixture(
    "env-inlining",
    {
      "index.ts": `${pe}.NODE_ENV = "production";
${pe}.YOLO = "woo!";
console.log(${pe}.NODE_ENV, ${pe}.YOLO);`,
    },
    ["index.ts"],
    dotenvRunEnv({ YOLO: "boo" })
  );
  probes.push(
    cliProbe(
      "cli.run.env.inlining",
      inlining.exitCode === 0 && inlining.stdout.trim() === "production woo!",
      inlining.stdout.trim()
    )
  );

  const issue3911 = await withCliFixture(
    "env-3911",
    { ".env": 'KEY="a\\nb"', "index.ts": "console.log(process.env.KEY);" },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.issue-3911",
      issue3911.exitCode === 0 && issue3911.stdout.trim() === "a\nb",
      issue3911.exitCode === 0 ? "escaped newline" : `exit=${issue3911.exitCode}`
    )
  );

  const expected = "a".repeat(4094);
  const bufferBoundary = await withCliFixture(
    "env-buffer",
    {
      ".env": `KEY="${expected}a"`,
      "index.ts": "console.log(process.env.KEY);",
    },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.buffer-boundary",
      bufferBoundary.exitCode === 0 && bufferBoundary.stdout.trim() === `${expected}a`,
      bufferBoundary.exitCode === 0 ? "4095 chars" : `len=${bufferBoundary.stdout.trim().length}`
    )
  );

  const space411 = await withCliFixture(
    "env-space-411",
    {
      ".env": "VARNAME=A B",
      "index.ts": "console.log('[' + process.env.VARNAME + ']');",
    },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.space-411",
      space411.exitCode === 0 && space411.stdout.trim() === "[A B]",
      space411.stdout.trim()
    )
  );

  const envNodeOverrides = await withCliFixture(
    "env-node-overrides",
    {
      ".env": "FOO=.env\n",
      ".env.development": "FOO=.env.development\n",
      "index.ts": ENV_INDEX_FOO,
    },
    ["index.ts"],
    dotenvRunEnv({ NODE_ENV: "development" })
  );
  probes.push(
    cliProbe(
      "cli.run.env.node-env-overrides",
      envNodeOverrides.exitCode === 0 && envNodeOverrides.stdout.trim() === ".env.development",
      envNodeOverrides.stdout.trim()
    )
  );

  const envFallback = await withCliFixture(
    "env-fallback",
    { ".env": "BUNTEST_DOTENV=1", "index.ts": BUNTEST_INDEX },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.fallback-dotenv",
      envFallback.exitCode === 0 && envFallback.stdout.trim() === "BUNTEST_DOTENV=1",
      envFallback.stdout.trim()
    )
  );

  const bunEnvApi = await withCliFixture(
    "env-bun-api",
    { ".env": "FOO=1\n", "index.ts": "console.log(Bun.env.FOO);" },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.bun-env",
      bunEnvApi.exitCode === 0 && bunEnvApi.stdout.trim() === "1",
      bunEnvApi.stdout.trim()
    )
  );

  const processEnvApi = await withCliFixture(
    "env-process-api",
    { ".env": "FOO=1\n", "index.ts": "console.log(process.env.FOO);" },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.process-env",
      processEnvApi.exitCode === 0 && processEnvApi.stdout.trim() === "1",
      processEnvApi.stdout.trim()
    )
  );

  const importMetaEnv = await withCliFixture(
    "env-import-meta",
    { ".env": "FOO=1\n", "index.ts": "console.log(import.meta.env.FOO);" },
    ["index.ts"],
    base
  );
  probes.push(
    cliProbe(
      "cli.run.env.import-meta",
      importMetaEnv.exitCode === 0 && importMetaEnv.stdout.trim() === "1",
      importMetaEnv.stdout.trim()
    )
  );

  return probes;
}
