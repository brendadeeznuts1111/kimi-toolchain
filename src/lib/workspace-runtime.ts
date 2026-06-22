import { pathExists } from "./bun-io.ts";
import { gitBranch, gitRevParse, gitStatus, isGitRepo } from "./git-helpers.ts";
import { configTomlPath, desktopRoot, mcpPath } from "./paths.ts";
import { resolveProjectRoot } from "./utils.ts";

export async function inspectWorkspaceRuntime(cwd = Bun.cwd) {
  const projectRoot = await resolveProjectRoot(cwd);
  const inRepo = await isGitRepo(projectRoot);
  let branch: string | undefined;
  let head: string | undefined;
  let dirty: boolean | undefined;
  if (inRepo) {
    branch = await gitBranch(projectRoot);
    head = (await gitRevParse(projectRoot, "HEAD")) ?? undefined;
    dirty = (await gitStatus(projectRoot)).trim().length > 0;
  }
  return {
    projectRoot,
    isGitRepository: inRepo,
    branch,
    head,
    dirty,
    kimiCode: {
      desktopRoot: desktopRoot(),
      mcpJson: mcpPath(),
      configToml: configTomlPath(),
      mcpPresent: pathExists(mcpPath()),
      configPresent: pathExists(configTomlPath()),
    },
  };
}

export function formatWorkspaceRuntimeSnapshot(
  snap: Awaited<ReturnType<typeof inspectWorkspaceRuntime>>
): string {
  const lines = [`workspace:  ${snap.projectRoot}`];
  if (snap.isGitRepository) {
    lines.push(
      `  git:        ${snap.branch ?? "?"} @ ${snap.head?.slice(0, 12) ?? "?"}${snap.dirty ? " (dirty)" : ""}`
    );
  }
  lines.push(
    `  kimi-code:  ${snap.kimiCode.desktopRoot}`,
    `  mcp.json:   ${snap.kimiCode.mcpJson}`,
    `  config:     ${snap.kimiCode.configToml}`
  );
  return lines.join("\n");
}
