/**
 * Read-only Kimi Code config.toml audit — permissions and MCP tool rules.
 * Never writes config.toml; suggests templates only.
 * @see https://moonshotai.github.io/kimi-code/en/configuration/config-files.html
 */

import { existsSync } from "fs";
import { join } from "path";
import { ensureDir } from "./utils.ts";
import { UNIFIED_SHELL_TOOL } from "./mcp-config.ts";

const PERMISSION_SNIPPET = `
# Kimi toolchain — unified-shell MCP permission (uncomment to pre-approve)
# [[permission.rules]]
# decision = "allow"
# pattern = "${UNIFIED_SHELL_TOOL}"
`;

function hookSnippet(home: string): string {
  const hookPath = join(home, ".kimi-code", "kimi-hooks", "log-tool-failure.ts");
  return `
[[hooks]]
event = "PostToolUseFailure"
command = "bun run ${hookPath}"
timeout = 10
`;
}

export interface PermissionRule {
  decision: string;
  pattern: string;
}

export interface ConfigAuditCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}

export function configTomlPath(home: string = Bun.env.HOME || "/tmp"): string {
  return join(home, ".kimi-code", "config.toml");
}

export function parsePermissionRules(text: string): PermissionRule[] {
  const rules: PermissionRule[] = [];
  const blocks = text.split(/\[\[permission\.rules\]\]/);
  for (const block of blocks.slice(1)) {
    const decision = block.match(/decision\s*=\s*"([^"]+)"/)?.[1];
    const pattern = block.match(/pattern\s*=\s*"([^"]+)"/)?.[1];
    if (decision && pattern) rules.push({ decision, pattern });
  }
  return rules;
}

export function parseDefaultPermissionMode(text: string): string {
  return text.match(/default_permission_mode\s*=\s*"([^"]+)"/)?.[1] ?? "manual";
}

export function allowsUnifiedShellMcp(rules: PermissionRule[]): boolean {
  for (const rule of rules) {
    if (rule.decision !== "allow") continue;
    if (rule.pattern === UNIFIED_SHELL_TOOL) return true;
    if (rule.pattern === "mcp__unified-shell__*") return true;
    if (rule.pattern.includes("unified-shell")) return true;
  }
  return false;
}

export async function auditKimiConfig(
  home: string = Bun.env.HOME || "/tmp",
  options: { unifiedShellRegistered?: boolean } = {}
): Promise<ConfigAuditCheck[]> {
  const checks: ConfigAuditCheck[] = [];
  const path = configTomlPath(home);
  const unifiedShellRegistered = options.unifiedShellRegistered ?? true;

  if (!existsSync(path)) {
    checks.push({
      name: "config-toml",
      status: "warn",
      message: "missing — run kimi login; kimi-doctor --fix can seed permissions snippet",
      fixable: true,
    });
    if (unifiedShellRegistered) {
      checks.push({
        name: "mcp-permission",
        status: "warn",
        message: `cannot audit — config.toml missing (needs allow for ${UNIFIED_SHELL_TOOL})`,
        fixable: true,
      });
    }
    return checks;
  }

  checks.push({ name: "config-toml", status: "ok", message: path, fixable: false });

  const text = await Bun.file(path).text();
  const rules = parsePermissionRules(text);
  const mode = parseDefaultPermissionMode(text);
  const shellAllowed = allowsUnifiedShellMcp(rules);

  if (shellAllowed) {
    checks.push({
      name: "mcp-permission",
      status: "ok",
      message: `allow rule for ${UNIFIED_SHELL_TOOL}`,
      fixable: false,
    });
  } else if (unifiedShellRegistered) {
    checks.push({
      name: "mcp-permission",
      status: "warn",
      message: `no allow rule for ${UNIFIED_SHELL_TOOL} — run kimi-doctor --fix to append snippet`,
      fixable: true,
    });
  } else {
    checks.push({
      name: "mcp-permission",
      status: "ok",
      message: "unified-shell not registered — permission rule not required",
      fixable: false,
    });
  }

  if (mode === "yolo") {
    const msg = shellAllowed
      ? "default_permission_mode=yolo with explicit MCP allow"
      : "default_permission_mode=yolo — MCP shell may auto-approve without explicit allow rule";
    checks.push({
      name: "permission-mode",
      status: shellAllowed ? "ok" : "warn",
      message: msg,
      fixable: false,
    });
  } else {
    checks.push({
      name: "permission-mode",
      status: "ok",
      message: `default_permission_mode=${mode}`,
      fixable: false,
    });
  }

  if (text.includes("PostToolUseFailure") && text.includes("log-tool-failure.ts")) {
    checks.push({
      name: "failure-hook",
      status: "ok",
      message: "PostToolUseFailure hook configured",
      fixable: false,
    });
  } else {
    checks.push({
      name: "failure-hook",
      status: "warn",
      message: "PostToolUseFailure hook not configured — run kimi-doctor --fix",
      fixable: true,
    });
  }

  return checks;
}

/** Idempotent merge — appends commented permission snippet; never overwrites existing config. */
export async function mergeConfigTomlPermissions(
  home: string = Bun.env.HOME || "/tmp"
): Promise<{ merged: boolean; created: boolean; path: string }> {
  const path = configTomlPath(home);
  ensureDir(join(path, ".."));

  if (!existsSync(path)) {
    await Bun.write(
      path,
      `# Kimi Code config — generated by kimi-doctor --fix\n${PERMISSION_SNIPPET}\n`
    );
    return { merged: true, created: true, path };
  }

  const text = await Bun.file(path).text();
  const rules = parsePermissionRules(text);
  if (allowsUnifiedShellMcp(rules)) {
    return { merged: false, created: false, path };
  }
  if (text.includes(UNIFIED_SHELL_TOOL)) {
    return { merged: false, created: false, path };
  }
  if (text.includes("Kimi toolchain — unified-shell MCP permission")) {
    return { merged: false, created: false, path };
  }

  await Bun.write(path, text.trimEnd() + PERMISSION_SNIPPET + "\n");
  return { merged: true, created: false, path };
}

/** Idempotent merge — appends PostToolUseFailure hook snippet. */
export async function mergeConfigTomlHooks(
  home: string = Bun.env.HOME || "/tmp"
): Promise<{ merged: boolean; created: boolean; path: string }> {
  const path = configTomlPath(home);
  ensureDir(join(path, ".."));

  if (!existsSync(path)) {
    await Bun.write(
      path,
      `# Kimi Code config — generated by kimi-doctor --fix\n${hookSnippet(home)}\n`
    );
    return { merged: true, created: true, path };
  }

  const text = await Bun.file(path).text();
  if (text.includes("PostToolUseFailure") || text.includes("log-tool-failure.ts")) {
    return { merged: false, created: false, path };
  }

  await Bun.write(path, text.trimEnd() + hookSnippet(home) + "\n");
  return { merged: true, created: false, path };
}
