import { pathExists, readText } from "./bun-io.ts";

import { join, resolve } from "path";
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
  return candidates.find((dir) => pathExists(dir)) ?? candidates[0];
}

const TEMPLATE_DIR = resolveTemplateDir();

function loadTemplate(name: string): string {
  const path = join(TEMPLATE_DIR, name);
  if (!pathExists(path)) {
    throw new Error(`Template missing: templates/scaffold/${name}`);
  }
  return readText(path);
}

export const DX_CONFIG_APP_TEMPLATE = loadTemplate("dx.config.app.toml");
export const DX_CONFIG_TOOLCHAIN_TEMPLATE = loadTemplate("dx.config.toolchain.toml");

export const SCAFFOLD_BUN_IO_TEMPLATE = loadTemplate("scripts/lib/bun-io.ts");
export const SCAFFOLD_BUN_UTILS_TEMPLATE = loadTemplate("scripts/lib/bun-utils.ts");
export const FINISH_WORK_CONFIG_TEMPLATE = loadTemplate("scripts/finish-work-config.ts");
export const FINISH_WORK_TEMPLATE = loadTemplate("scripts/finish-work.ts");
export const FINISH_WORK_HERDR_TEMPLATE = loadTemplate("scripts/finish-work-herdr.ts");
export const REVIEWER_PANE_TEMPLATE = loadTemplate("scripts/reviewer-pane.ts");

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
  if (!pathExists(dxConfigPath)) return null;

  const content = readText(dxConfigPath);
  const hasToolchainMarkers = content.includes("[finishWork]") || content.includes("[herdr]");

  if (profile === "toolchain") {
    const missing: string[] = [];
    for (const script of ["scripts/finish-work.ts", "scripts/reviewer-pane.ts"]) {
      if (!pathExists(join(projectRoot, script))) missing.push(script);
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

export function packageScriptEntriesForProfile(profile: ScaffoldProfile): Record<string, string> {
  if (profile === "toolchain") {
    return {
      "finish-work": "bun run scripts/finish-work.ts",
    };
  }
  return {};
}

export const TOOLCHAIN_SCAFFOLD_LIB_NAMES = ["lib/bun-io.ts", "lib/bun-utils.ts"] as const;

export const TOOLCHAIN_SCAFFOLD_SCRIPT_NAMES = [
  "finish-work-config.ts",
  "finish-work-herdr.ts",
  "finish-work.ts",
  "reviewer-pane.ts",
] as const;
