/**
 * Scaffold alignment soft gate — for projects with dx.config.toml [kimi] preflight.
 */

import { existsSync } from "fs";
import { join } from "path";

export interface ScaffoldCheck {
  name: string;
  status: "ok" | "warn";
  message: string;
}

export interface ScaffoldAlignmentReport {
  applicable: boolean;
  aligned: boolean;
  checks: ScaffoldCheck[];
}

const AGENTS_MARKERS = [
  "Kimi Code",
  ".config/dx/AGENTS.md",
  "dx setup",
  "dx mcp-status",
  "dx cli",
  "dx package",
  "Cloudflare SSO/OAuth is separate",
  "./CODE_REFERENCES.md",
  "closest existing pattern",
  "kimi-doctor --agent-ready",
  "kimi-githooks doctor",
  "bun run check",
  "kimi-governance",
] as const;

export async function hasKimiPreflight(projectDir: string): Promise<boolean> {
  const path = join(projectDir, "dx.config.toml");
  if (!existsSync(path)) return false;
  const text = await Bun.file(path).text();
  return /\[kimi\]/i.test(text) && /preflight\s*=\s*true/i.test(text);
}

export async function checkScaffoldAligned(projectDir: string): Promise<ScaffoldAlignmentReport> {
  const applicable = await hasKimiPreflight(projectDir);
  if (!applicable) {
    return { applicable: false, aligned: true, checks: [] };
  }

  const checks: ScaffoldCheck[] = [];
  const agentsPath = join(projectDir, "AGENTS.md");

  if (!existsSync(agentsPath)) {
    checks.push({ name: "AGENTS.md", status: "warn", message: "missing" });
  } else {
    const text = (await Bun.file(agentsPath).text()).toLowerCase();
    const missing = AGENTS_MARKERS.filter((m) => !text.includes(m.toLowerCase()));
    checks.push({
      name: "AGENTS.md",
      status: missing.length === 0 ? "ok" : "warn",
      message: missing.length === 0 ? "scaffold markers present" : `missing: ${missing.join(", ")}`,
    });
  }

  const aligned = checks.every((c) => c.status === "ok");
  return { applicable, aligned, checks };
}
