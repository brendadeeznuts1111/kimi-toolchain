import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homeDir } from "./paths.ts";

export type ScaffoldProfile = "app" | "toolchain";

const PROFILE_ALIASES: Record<string, ScaffoldProfile> = {
  app: "app",
  toolchain: "toolchain",
};

function resolveTemplateDir(): string {
  const candidates = [
    join(import.meta.dir, "..", "..", "templates", "scaffold"),
    join(import.meta.dir, "..", "templates", "scaffold"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

const TEMPLATE_DIR = resolveTemplateDir();

function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATE_DIR, name), "utf8");
}

export const DX_CONFIG_APP_TEMPLATE = loadTemplate("dx.config.app.toml");
export const DX_CONFIG_TOOLCHAIN_TEMPLATE = loadTemplate("dx.config.toolchain.toml");
export const DX_WORKSPACE_TEMPLATE = loadTemplate("dx.workspace.toml");

export const FINISH_WORK_CONFIG_TEMPLATE = loadTemplate("scripts/finish-work-config.ts");
export const FINISH_WORK_TEMPLATE = loadTemplate("scripts/finish-work.ts");

export function resolveScaffoldProfile(argv: readonly string[]): ScaffoldProfile {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile") {
      const next = argv[i + 1];
      if (next && PROFILE_ALIASES[next]) return PROFILE_ALIASES[next];
      continue;
    }
    if (arg.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length);
      if (PROFILE_ALIASES[value]) return PROFILE_ALIASES[value];
    }
  }
  return "app";
}

export function filterScaffoldArgv(argv: readonly string[]): string[] {
  const filtered: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile") {
      i++;
      continue;
    }
    if (arg.startsWith("--profile=")) continue;
    filtered.push(arg);
  }
  return filtered;
}

export function dxAgentsPath(home = homeDir()): string {
  return join(home, ".config", "dx", "AGENTS.md");
}

export function renderTemplate(template: string, replacements: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

export function renderDxConfig(
  profile: ScaffoldProfile,
  projectName: string,
  home = homeDir()
): string {
  const template = profile === "toolchain" ? DX_CONFIG_TOOLCHAIN_TEMPLATE : DX_CONFIG_APP_TEMPLATE;
  return renderTemplate(template, {
    PROJECT_NAME: projectName,
    DX_AGENTS_PATH: dxAgentsPath(home),
  });
}

export function renderWorkspaceToml(projectName: string): string {
  return renderTemplate(DX_WORKSPACE_TEMPLATE, { PROJECT_NAME: projectName });
}

export function packageScriptEntriesForProfile(profile: ScaffoldProfile): Record<string, string> {
  if (profile === "toolchain") {
    return {
      "finish-work": "bun run scripts/finish-work.ts",
    };
  }
  return {};
}

export const TOOLCHAIN_SCAFFOLD_SCRIPT_NAMES = ["finish-work-config.ts", "finish-work.ts"] as const;
