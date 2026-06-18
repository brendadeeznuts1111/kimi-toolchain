import { writeText } from "./bun-io.ts";

import { Effect, Exit } from "effect";
import {
  gitBranch,
  gitLastCommitMessage,
  gitLog,
  gitRevParse,
  gitStatus,
  isGitRepo,
} from "./git-helpers.ts";
import { readEffectGatesSnapshots, type EffectGatesReport } from "./effect-gates.ts";
import { extractAgentsNextSteps, type AgentContext } from "./dx-config-agents.ts";
import {
  DxConfigLive,
  getAgentContext,
  summarizeDxConfigCause,
  type DxConfigErrorSummary,
} from "./effect/dx-config.ts";
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
  agentContext: AgentContext;
  iterate?: string;
  fullValidation?: string;
  nextSteps: string[];
  /** Structured DX config load failures (empty when merge succeeded). */
  configErrors: DxConfigErrorSummary[];
  markdown: string;
  /** HTML rendering of the markdown report (set when --html flag is used). */
  html?: string;
}

const EMPTY_AGENT_CONTEXT: AgentContext = {
  firstRead: [],
  bootstrap: [],
  prePush: [],
  handoff: [],
  avoid: [],
};

async function loadAgentContext(projectRoot: string): Promise<{
  agentContext: AgentContext;
  configErrors: DxConfigErrorSummary[];
}> {
  const exit = await Effect.runPromiseExit(
    getAgentContext(projectRoot).pipe(Effect.provide(DxConfigLive()))
  );
  if (Exit.isSuccess(exit)) {
    return { agentContext: exit.value, configErrors: [] };
  }
  return {
    agentContext: EMPTY_AGENT_CONTEXT,
    configErrors: summarizeDxConfigCause(exit.cause),
  };
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

  if (report.configErrors.length) {
    lines.push("");
    lines.push("## Config errors");
    for (const err of report.configErrors) {
      lines.push(`- **${err.tag}:** ${err.message}`);
    }
  }

  if (report.iterate || report.fullValidation) {
    lines.push("");
    lines.push("## Agent commands");
    if (report.iterate) {
      lines.push(`- **Iterate:** \`${report.iterate}\``);
    }
    if (report.fullValidation) {
      lines.push(`- **Full validation:** \`${report.fullValidation}\``);
    }
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
  const { agentContext, configErrors } = await loadAgentContext(projectRoot);
  const nextSteps = extractAgentsNextSteps({ agents: agentContext });

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
    agentContext,
    iterate: agentContext.iterate,
    fullValidation: agentContext.fullValidation,
    nextSteps,
    configErrors,
  };

  return {
    ...base,
    markdown: buildMarkdown(base, brief),
  };
}

const DEFAULT_CONTEXT_JSON_FILE = "/tmp/workspace-context.json";

export function resolveContextJsonFilePath(): string {
  const override = Bun.env.HERDR_CONTEXT_JSON_FILE?.trim();
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
  writeText(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return path;
}
