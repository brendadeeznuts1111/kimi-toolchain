#!/usr/bin/env bun
/**
 * Agent commit wrapper — commits as kimi-agent with human committer attribution.
 *
 * Usage:
 *   bun run scripts/agent-commit.ts "feat: add Bun.hash.crc32 to archive baseline"
 *   bun run agent:commit "feat: add Bun.hash.crc32 to archive baseline"
 */

import { $ } from "bun";

const REPO_ROOT = `${import.meta.dir}/..`;

const AGENT_NAME = "kimi-agent";
const AGENT_EMAIL = "agent@kimi.factory-wager.com";
const HUMAN_NAME = "nolarose";
const HUMAN_EMAIL = "nolarose@factory-wager.com";

async function packageVersion(): Promise<string> {
  try {
    const pkg = (await Bun.file(`${REPO_ROOT}/package.json`).json()) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const message =
    argv
      .filter((a) => !a.startsWith("--"))
      .join(" ")
      .trim() || "agent update";
  const sessionId = Bun.env.KIMI_SESSION_ID || `agent-${Date.now()}`;
  const zone = Bun.env.KIMI_ZONE || "kimi-toolchain";
  const buildVersion = await packageVersion();

  const body = [
    message,
    "",
    `Signed-off-by: ${HUMAN_NAME} <${HUMAN_EMAIL}>`,
    `Co-authored-by: ${AGENT_NAME} <${AGENT_EMAIL}>`,
    "",
    "[agent-meta]",
    `session: ${sessionId}`,
    `zone: ${zone}`,
    `build: ${buildVersion}`,
    `timestamp: ${new Date().toISOString()}`,
    `directive: ${Bun.env.KIMI_DIRECTIVE_VERSION ?? "v2.0.0"}`,
    ...(Bun.env.KIMI_DIRECTIVE_PHASES ? [`phases: [${Bun.env.KIMI_DIRECTIVE_PHASES}]`] : []),
  ].join("\n");

  const env = {
    ...Bun.env,
    GIT_AUTHOR_NAME: AGENT_NAME,
    GIT_AUTHOR_EMAIL: AGENT_EMAIL,
    GIT_COMMITTER_NAME: HUMAN_NAME,
    GIT_COMMITTER_EMAIL: HUMAN_EMAIL,
  };

  await $`git commit -m ${body}`.env(env);
}

if (import.meta.main) {
  await main();
}
