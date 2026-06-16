import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homeDir } from "./paths.ts";

export type ScaffoldProfile = "app" | "toolchain";

const PROFILE_ALIASES: Record<string, ScaffoldProfile> = {
  app: "app",
  toolchain: "toolchain",
};

export class ScaffoldProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldProfileError";
  }
}

function resolveTemplateDir(): string {
  const candidates = [
    join(import.meta.dir, "..", "..", "templates", "scaffold"),
    join(import.meta.dir, "..", "templates", "scaffold"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

const TEMPLATE_DIR = resolveTemplateDir();

function loadTemplate(name: string): string {
  const path = join(TEMPLATE_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Template missing: templates/scaffold/${name}`);
  }
  return readFileSync(path, "utf8");
}

export const DX_CONFIG_APP_TEMPLATE = loadTemplate("dx.config.app.toml");
export const DX_CONFIG_TOOLCHAIN_TEMPLATE = loadTemplate("dx.config.toolchain.toml");
export const DX_WORKSPACE_TEMPLATE = loadTemplate("dx.workspace.toml");

export const FINISH_WORK_CONFIG_TEMPLATE = loadTemplate("scripts/finish-work-config.ts");
export const FINISH_WORK_TEMPLATE = loadTemplate("scripts/finish-work.ts");

function parseProfileValue(value: string | undefined): ScaffoldProfile {
  if (!value || value.startsWith("-")) {
    throw new ScaffoldProfileError("--profile requires a value: app or toolchain");
  }
  const profile = PROFILE_ALIASES[value];
  if (!profile) {
    throw new ScaffoldProfileError(`Unknown scaffold profile "${value}" — use app or toolchain`);
  }
  return profile;
}

export function resolveScaffoldProfile(argv: readonly string[]): ScaffoldProfile {
  let explicit: ScaffoldProfile | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile") {
      explicit = parseProfileValue(argv[i + 1]);
      continue;
    }
    if (arg.startsWith("--profile=")) {
      explicit = parseProfileValue(arg.slice("--profile=".length));
    }
  }
  return explicit ?? "app";
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
  return resolve(home, ".config", "dx", "AGENTS.md");
}

export function detectProfileDrift(projectRoot: string, profile: ScaffoldProfile): string | null {
  const dxConfigPath = join(projectRoot, "dx.config.toml");
  if (!existsSync(dxConfigPath)) return null;

  const content = readFileSync(dxConfigPath, "utf8");
  const hasToolchainMarkers = content.includes("[finishWork]") || content.includes("[herdr]");

  if (profile === "toolchain") {
    const missing: string[] = [];
    if (!existsSync(join(projectRoot, "dx", "workspace.toml"))) {
      missing.push("dx/workspace.toml");
    }
    if (!existsSync(join(projectRoot, "scripts", "finish-work.ts"))) {
      missing.push("scripts/finish-work.ts");
    }
    if (missing.length > 0) {
      return (
        `Profile toolchain but missing ${missing.join(", ")} — kimi-fix skips existing files; ` +
        "delete them and re-run or scaffold into a fresh tree"
      );
    }
    if (!hasToolchainMarkers) {
      return (
        "Profile toolchain but dx.config.toml lacks [finishWork]/[herdr] — " +
        "delete dx.config.toml and re-run kimi-fix --profile toolchain"
      );
    }
  }

  if (profile === "app" && hasToolchainMarkers) {
    return "Profile app but dx.config.toml has toolchain sections — kimi-fix will not downgrade existing config";
  }

  return null;
}

export function renderTemplate(template: string, replacements: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

export function scaffoldDxConfigTemplateRel(profile: ScaffoldProfile): string {
  return profile === "toolchain" ? "dx.config.toolchain.toml" : "dx.config.app.toml";
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
