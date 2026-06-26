import { $ } from "bun";

export interface Commit {
  hash: string;
  subject: string;
  body: string;
  type: string;
  scope: string | undefined;
  breaking: boolean;
}

const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/;

export function parseCommit(hash: string, subject: string, body: string): Commit | null {
  const match = CONVENTIONAL_RE.exec(subject);
  if (!match) return null;

  const [, type, scope, _msg] = match;
  if (!type) return null;
  const breaking = subject.endsWith("!") || body.includes("BREAKING CHANGE:");

  return { hash, subject, body, type: type.toLowerCase(), scope, breaking };
}

export async function getCommits(sinceTag?: string): Promise<Commit[]> {
  const range = sinceTag ? `${sinceTag}..HEAD` : undefined;
  const result = range
    ? await $`git log ${range} --format=%H%x00%s%x00%b%x00`.nothrow().quiet()
    : await $`git log --format=%H%x00%s%x00%b%x00`.nothrow().quiet();
  if (result.exitCode !== 0) return [];

  const raw = result.stdout.toString();
  const parts = raw.split("\x00");
  const commits: Commit[] = [];

  for (let i = 0; i < parts.length; i += 3) {
    const hash = parts[i]?.trim() || "";
    const subject = parts[i + 1]?.trim() || "";
    const body = parts[i + 2]?.trim() || "";
    if (!hash && !subject) continue;
    const parsed = parseCommit(hash, subject, body);
    if (parsed) commits.push(parsed);
  }

  return commits;
}

export async function getLastTag(): Promise<string | undefined> {
  try {
    const result = await $`git describe --tags --abbrev=0`.nothrow().quiet();
    return result.stdout?.toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

export function determineBump(commits: Commit[]): "major" | "minor" | "patch" | "none" {
  let hasBreaking = false;
  let hasFeature = false;
  let hasFix = false;

  for (const c of commits) {
    if (c.breaking) hasBreaking = true;
    else if (c.type === "feat") hasFeature = true;
    else if (c.type === "fix") hasFix = true;
  }

  if (hasBreaking) return "major";
  if (hasFeature) return "minor";
  if (hasFix) return "patch";
  return "none";
}

export function bumpVersion(current: string, bump: "major" | "minor" | "patch"): string {
  const [major = 0, minor = 0, patch = 0] = current.replace(/^v/, "").split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export async function validateCommits(
  projectDir: string
): Promise<{ valid: Commit[]; invalid: string[] }> {
  const result = await $`git log --format=%H%x00%s%x00%b%x00`.cwd(projectDir).nothrow().quiet();
  const raw = result.stdout.toString();
  const parts = raw.split("\x00");

  const valid: Commit[] = [];
  const invalid: string[] = [];

  for (let i = 0; i < parts.length; i += 3) {
    const hash = parts[i]?.trim() || "";
    const subject = parts[i + 1]?.trim() || "";
    const body = parts[i + 2] ?? "";
    const parsed = parseCommit(hash, subject, body);
    if (parsed) valid.push(parsed);
    else if (subject) invalid.push(subject);
  }

  return { valid, invalid };
}
