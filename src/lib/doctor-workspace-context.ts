import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOML } from "bun";
import {
  gitBranch,
  gitLastCommitMessage,
  gitLog,
  gitRevParse,
  gitStatus,
  isGitRepo,
} from "./git-helpers.ts";
import { readEffectGatesSnapshots, type EffectGatesReport } from "./effect-gates.ts";
import { getProjectName } from "./utils.ts";

export interface WorkspaceContextOptions {
  projectRoot: string;
  /** Shorter markdown — fewer commits, compact effect-gates line. */
  brief?: boolean;
}

export interface WorkspaceContextReport {
  schemaVersion: 1;
  tool: "kimi-doctor";
  mode: "workspace-context";
  project: string;
  projectRoot: string;
  generatedAt: string;
  git: {
    isRepo: boolean;
    branch: string | null;
    head: string | null;
    headShort: string | null;
    dirty: boolean;
    dirtyCount: number;
    lastCommit: string | null;
    recentCommits: Array<{ hash: string; subject: string }>;
  };
  effectGates: EffectGatesReport | null;
  nextSteps: string[];
  markdown: string;
}

function readDxAgentsNextSteps(projectRoot: string): string[] {
  const path = join(projectRoot, "dx.config.toml");
  if (!existsSync(path)) return [];
  try {
    const doc = TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const agents =
      doc.agents && typeof doc.agents === "object" ? (doc.agents as Record<string, unknown>) : null;
    if (!agents) return [];

    const steps: string[] = [];
    if (typeof agents.iterate === "string" && agents.iterate.trim()) {
      steps.push(agents.iterate.trim());
    }
    if (Array.isArray(agents.handoff)) {
      for (const row of agents.handoff) {
        if (typeof row === "string" && row.trim()) steps.push(row.trim());
      }
    }
    if (Array.isArray(agents.prePush)) {
      for (const row of agents.prePush.slice(0, 2)) {
        if (typeof row === "string" && row.trim()) steps.push(row.trim());
      }
    }
    return [...new Set(steps)];
  } catch {
    return [];
  }
}

function parseRecentCommits(
  logText: string,
  limit: number
): Array<{ hash: string; subject: string }> {
  if (!logText) return [];
  return logText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => {
      const tab = line.indexOf("\t");
      if (tab < 0) return { hash: line.slice(0, 7), subject: line };
      return { hash: line.slice(0, tab).slice(0, 7), subject: line.slice(tab + 1) };
    });
}

function formatEffectGatesLine(snapshot: EffectGatesReport | null, brief: boolean): string[] {
  if (!snapshot) return ["_No effect-gates snapshot yet — run `kimi-doctor --effect-gates`._"];
  const { counts, summary } = snapshot;
  if (brief) {
    return [
      `Errors ${summary.errors}, warnings ${summary.warnings} · directPromise ${counts.directPromise} · layerCircularity ${counts.layerCircularity}`,
    ];
  }
  return [
    `Errors **${summary.errors}**, warnings **${summary.warnings}**`,
    `- directPromise: ${counts.directPromise}`,
    `- missingServiceTag: ${counts.missingServiceTag}`,
    `- domainPurity: ${counts.domainPurity}`,
    `- layerCircularity: ${counts.layerCircularity}`,
    `- runPromiseBoundary: ${counts.runPromiseBoundary}`,
    snapshot.generatedAt ? `- snapshot: ${snapshot.generatedAt}` : "",
  ].filter(Boolean);
}

function buildMarkdown(report: Omit<WorkspaceContextReport, "markdown">, brief: boolean): string {
  const lines: string[] = [];
  lines.push(`# Workspace context: ${report.project}`);
  lines.push("");

  if (report.git.isRepo) {
    const head = report.git.headShort || "unknown";
    const branch = report.git.branch || "unknown";
    const dirty =
      report.git.dirtyCount > 0
        ? `${report.git.dirtyCount} uncommitted change(s)`
        : "clean working tree";
    lines.push(`**Branch:** \`${branch}\` @ \`${head}\``);
    lines.push(`**Status:** ${dirty}`);
    if (report.git.lastCommit) {
      lines.push(`**Latest commit:** ${report.git.lastCommit}`);
    }
  } else {
    lines.push("_Not a git repository._");
  }

  if (report.git.recentCommits.length) {
    lines.push("");
    lines.push("## Recent commits");
    for (const commit of report.git.recentCommits) {
      lines.push(`- \`${commit.hash}\` ${commit.subject}`);
    }
  }

  lines.push("");
  lines.push("## Effect gates");
  for (const row of formatEffectGatesLine(report.effectGates, brief)) {
    lines.push(brief && !row.startsWith("_") && !row.startsWith("-") ? `- ${row}` : row);
  }

  if (report.nextSteps.length) {
    lines.push("");
    lines.push("## Suggested next steps");
    for (const step of report.nextSteps) {
      lines.push(`- \`${step}\``);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

/** Build a markdown workspace brief for agent handoff after rebuild. */
export async function buildWorkspaceContextReport(
  options: WorkspaceContextOptions
): Promise<WorkspaceContextReport> {
  const { projectRoot, brief = false } = options;
  const project = await getProjectName(projectRoot);
  const commitLimit = brief ? 3 : 8;

  const repo = await isGitRepo(projectRoot);
  const branch = repo ? await gitBranch(projectRoot) : null;
  const head = repo ? await gitRevParse(projectRoot, "HEAD") : null;
  const headShort = head ? head.slice(0, 7) : null;
  const status = repo ? await gitStatus(projectRoot) : "";
  const dirtyLines = status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const lastCommit = repo ? await gitLastCommitMessage(projectRoot) : null;
  const logFormat = "%h\t%s";
  const logRange = brief ? "-5" : "-12";
  const logText = repo ? await gitLog(projectRoot, logFormat, logRange) : "";
  const recentCommits = parseRecentCommits(logText, commitLimit);

  const [effectGates] = await readEffectGatesSnapshots(projectRoot, 1);
  const nextSteps = readDxAgentsNextSteps(projectRoot);

  const base: Omit<WorkspaceContextReport, "markdown"> = {
    schemaVersion: 1,
    tool: "kimi-doctor",
    mode: "workspace-context",
    project,
    projectRoot,
    generatedAt: new Date().toISOString(),
    git: {
      isRepo: repo,
      branch,
      head,
      headShort,
      dirty: dirtyLines.length > 0,
      dirtyCount: dirtyLines.length,
      lastCommit,
      recentCommits,
    },
    effectGates: effectGates ?? null,
    nextSteps,
  };

  return {
    ...base,
    markdown: buildMarkdown(base, brief),
  };
}

const DEFAULT_CONTEXT_JSON_FILE = "/tmp/workspace-context.json";

export function resolveContextJsonFilePath(): string {
  const override = process.env.HERDR_CONTEXT_JSON_FILE?.trim();
  return override || DEFAULT_CONTEXT_JSON_FILE;
}

/** JSON payload for agents/tools (excludes markdown). */
export function workspaceContextJsonPayload(
  report: WorkspaceContextReport
): Omit<WorkspaceContextReport, "markdown"> {
  const { markdown: _markdown, ...payload } = report;
  return payload;
}

export function writeWorkspaceContextJsonFile(report: WorkspaceContextReport): string {
  const path = resolveContextJsonFilePath();
  const payload = workspaceContextJsonPayload(report);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return path;
}
