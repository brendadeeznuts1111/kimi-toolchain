#!/usr/bin/env bun
/**
 * Agent commit wrapper — commits as kimi-agent with human committer attribution.
 *
 * Usage:
 *   bun run scripts/agent-commit.ts "feat: add Bun.hash.crc32 to archive baseline"
 *   bun run agent:commit "feat: add Bun.hash.crc32 to archive baseline"
 */

import { join } from "path";
import { $ } from "bun";

const REPO_ROOT = join(import.meta.dir, "..");

const AGENT_NAME = "kimi-agent";
const AGENT_EMAIL = "agent@kimi.factory-wager.com";
const HUMAN_NAME = "nolarose";
const HUMAN_EMAIL = "nolarose@factory-wager.com";

async function packageVersion(): Promise<string> {
  try {
    const pkg = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function buildAgentMessage(
  subject: string,
  sessionId: string,
  zone: string,
  buildVersion: string
): string {
  return `${subject}

Signed-off-by: ${HUMAN_NAME} <${HUMAN_EMAIL}>
Co-authored-by: ${AGENT_NAME} <${AGENT_EMAIL}>

[agent-meta]
session: ${sessionId}
zone: ${zone}
build: ${buildVersion}
timestamp: ${new Date().toISOString()}`;
}

async function main(): Promise<void> {
  const message = process.argv.slice(2).join(" ").trim() || "agent update";
  const sessionId = process.env.KIMI_SESSION_ID || `agent-${Date.now()}`;
  const zone = process.env.KIMI_ZONE || "unknown";
  const buildVersion = await packageVersion();
  const body = buildAgentMessage(message, sessionId, zone, buildVersion);

  const env = {
    ...process.env,
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
