#!/usr/bin/env bun
/**
 * Git contribution metrics — human vs. agent commit ratio with session traceability.
 *
 * Parses [agent-meta] blocks from commit bodies for dashboard integration.
 *
 * Usage:
 *   bun run scripts/git-contribution-metrics.ts
 *   bun run scripts/git-contribution-metrics.ts --since 30.days
 *   bun run scripts/git-contribution-metrics.ts --json
 */

import { join } from "path";
import { $ } from "bun";
import { writeStdoutJsonSync } from "../src/lib/ndjson.ts";

const REPO_ROOT = join(import.meta.dir, "..");

const HUMAN_AUTHOR = "nolarose";
const AGENT_AUTHOR = "kimi-agent";

interface AgentMeta {
  session: string;
  zone: string;
  build: string;
  timestamp: string;
}

interface CommitRecord {
  hash: string;
  author: string;
  subject: string;
  role: "human" | "agent" | "other";
  agentMeta: AgentMeta | null;
}

interface ContributionSummary {
  since: string;
  total: number;
  human: number;
  agent: number;
  other: number;
  agentRatio: number;
  sessions: string[];
  zones: Record<string, number>;
  builds: Record<string, number>;
}

interface CliOptions {
  since: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { since: "90.days", json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") opts.json = true;
    else if (arg === "--since" && argv[i + 1]) opts.since = argv[++i]!;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Git contribution metrics

  --since RANGE  Git log range (default: 90.days)
  --json         JSON summary to stdout
`);
      process.exit(0);
    }
  }
  return opts;
}

function parseAgentMeta(body: string): AgentMeta | null {
  const block = body.match(/\[agent-meta\]\s*([\s\S]*?)(?:\n\n|\n*$)/);
  if (!block) return null;

  const fields: Partial<AgentMeta> = {};
  for (const line of block[1]!.split("\n")) {
    const match = line.trim().match(/^(\w+):\s*(.+)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "session") fields.session = value!;
    else if (key === "zone") fields.zone = value!;
    else if (key === "build") fields.build = value!;
    else if (key === "timestamp") fields.timestamp = value!;
  }

  if (!fields.session || !fields.zone || !fields.build || !fields.timestamp) return null;
  return fields as AgentMeta;
}

function classifyAuthor(author: string): CommitRecord["role"] {
  if (author === HUMAN_AUTHOR) return "human";
  if (author === AGENT_AUTHOR) return "agent";
  return "other";
}

function summarize(commits: CommitRecord[], since: string): ContributionSummary {
  const human = commits.filter((c) => c.role === "human").length;
  const agent = commits.filter((c) => c.role === "agent").length;
  const other = commits.filter((c) => c.role === "other").length;
  const total = commits.length;

  const sessions = new Set<string>();
  const zones: Record<string, number> = {};
  const builds: Record<string, number> = {};

  for (const commit of commits) {
    if (!commit.agentMeta) continue;
    sessions.add(commit.agentMeta.session);
    zones[commit.agentMeta.zone] = (zones[commit.agentMeta.zone] ?? 0) + 1;
    builds[commit.agentMeta.build] = (builds[commit.agentMeta.build] ?? 0) + 1;
  }

  return {
    since,
    total,
    human,
    agent,
    other,
    agentRatio: total > 0 ? agent / total : 0,
    sessions: [...sessions].sort(),
    zones,
    builds,
  };
}

async function loadCommits(since: string): Promise<CommitRecord[]> {
  const result = await $`git log --since=${since} --format=%H%x00%an%x00%s%x00%b%x00`
    .cwd(REPO_ROOT)
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) return [];

  const tokens = result.stdout.toString().split("\0");
  const commits: CommitRecord[] = [];
  for (let i = 0; i + 3 < tokens.length; i += 4) {
    const hash = tokens[i]!;
    const author = tokens[i + 1]!;
    const subject = tokens[i + 2]!;
    const body = tokens[i + 3] ?? "";
    if (!hash || !author) continue;
    commits.push({
      hash,
      author,
      subject,
      role: classifyAuthor(author),
      agentMeta: parseAgentMeta(body),
    });
  }
  return commits;
}

async function main(): Promise<number> {
  const opts = parseArgs(Bun.argv.slice(2));
  const commits = await loadCommits(opts.since);
  const summary = summarize(commits, opts.since);

  if (opts.json) {
    writeStdoutJsonSync({ summary, commits }, 2);
    return 0;
  }

  const pct = (n: number) =>
    summary.total > 0 ? `${Math.round((n / summary.total) * 100)}%` : "0%";
  console.log(`[git-contribution] since ${opts.since}`);
  console.log(`  total:  ${summary.total}`);
  console.log(`  human:  ${summary.human} (${pct(summary.human)})`);
  console.log(`  agent:  ${summary.agent} (${pct(summary.agent)})`);
  if (summary.other > 0) console.log(`  other:  ${summary.other} (${pct(summary.other)})`);
  if (summary.sessions.length > 0) {
    console.log(`  sessions: ${summary.sessions.length}`);
    for (const [zone, count] of Object.entries(summary.zones).sort()) {
      console.log(`    zone ${zone}: ${count}`);
    }
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
