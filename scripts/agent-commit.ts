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
import {
  DEFAULT_MIN_DELETION_RATIO,
  formatDeletionRatio,
  parseDiffStat,
  passesDeletionMetric,
} from "../src/lib/deletion-metric.ts";

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
  buildVersion: string,
  meta: { directive?: string; phases?: string; deletionRatio?: string }
): string {
  const lines = [
    subject,
    "",
    `Signed-off-by: ${HUMAN_NAME} <${HUMAN_EMAIL}>`,
    `Co-authored-by: ${AGENT_NAME} <${AGENT_EMAIL}>`,
    "",
    "[agent-meta]",
    `session: ${sessionId}`,
    `zone: ${zone}`,
    `build: ${buildVersion}`,
    `timestamp: ${new Date().toISOString()}`,
  ];
  if (meta.directive) lines.push(`directive: ${meta.directive}`);
  if (meta.phases) lines.push(`phases: ${meta.phases}`);
  if (meta.deletionRatio) lines.push(`deletion-ratio: ${meta.deletionRatio}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const enforceDeletion =
    argv.includes("--enforce-deletion") || Bun.env.KIMI_DELETION_METRIC_ENFORCE === "1";
  const message =
    argv
      .filter((a) => !a.startsWith("--"))
      .join(" ")
      .trim() || "agent update";
  const sessionId = Bun.env.KIMI_SESSION_ID || `agent-${Date.now()}`;
  const zone = Bun.env.KIMI_ZONE || "kimi-toolchain";
  const buildVersion = await packageVersion();

  const metrics = parseDiffStat(await $`git diff --stat --cached`.cwd(REPO_ROOT).text());
  const minRatio = Number(Bun.env.KIMI_DELETION_RATIO_MIN ?? DEFAULT_MIN_DELETION_RATIO);

  if (enforceDeletion && !passesDeletionMetric(metrics, minRatio)) {
    console.error(
      `[DELETION-METRIC] FAIL: ${metrics.added} additions, ${metrics.deleted} deletions (need ${minRatio.toFixed(1)}×)`
    );
    process.exit(1);
  }

  const body = buildAgentMessage(message, sessionId, zone, buildVersion, {
    directive: Bun.env.KIMI_DIRECTIVE_VERSION ?? "v1.1.0",
    phases: Bun.env.KIMI_DIRECTIVE_PHASES ? `[${Bun.env.KIMI_DIRECTIVE_PHASES}]` : undefined,
    deletionRatio:
      metrics.added > 0 || metrics.deleted > 0
        ? `${formatDeletionRatio(metrics.ratio)}x`
        : undefined,
  });

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
