/**
 * Kimi documentation alignment — soft gate for toolchain product-matrix docs.
 */

import { pathExists } from "./bun-io.ts";

import { join } from "path";
import { readPackageJson } from "./utils.ts";

export interface KimiDocsCheck {
  name: string;
  status: "ok" | "warn";
  message: string;
}

export interface KimiDocsAlignmentReport {
  applicable: boolean;
  aligned: boolean;
  checks: KimiDocsCheck[];
}

const DOC_MARKERS: Record<string, string[]> = {
  "UNIFIED.md": ["Kimi Work", "Kimi Code", "kimi-toolchain"],
  "AGENTS.md": ["kimi-toolchain", "Kimi Code", "CODE_REFERENCES.md"],
  "CODE_REFERENCES.md": [
    "src/lib/tool-runner.ts",
    "src/lib/effect/cli-runtime.ts",
    "Package Policy",
  ],
  "CONTEXT.md": ["Kimi Code", "kimi-toolchain", "CODE_REFERENCES.md"],
  "TEMPLATES.md": ["config.toml", "mcp.json", "CODE_REFERENCES.md"],
  "skills/kimi-toolchain/SKILL.md": ["/mcp", "unified-shell"],
};

const REQUIRED_FILES = ["templates/kimi-config-permissions.toml"] as const;

export async function isKimiToolchainProject(projectDir: string): Promise<boolean> {
  const pkg = await readPackageJson(
    projectDir,
    (p): p is { name?: string } => typeof p === "object" && p !== null && "name" in p
  );
  return pkg?.name === "kimi-toolchain";
}

export async function checkKimiDocsAligned(projectDir: string): Promise<KimiDocsAlignmentReport> {
  const applicable = await isKimiToolchainProject(projectDir);
  if (!applicable) {
    return { applicable: false, aligned: true, checks: [] };
  }

  const checks: KimiDocsCheck[] = [];

  for (const [relPath, markers] of Object.entries(DOC_MARKERS)) {
    const fullPath = join(projectDir, relPath);
    if (!pathExists(fullPath)) {
      checks.push({
        name: relPath,
        status: "warn",
        message: "missing",
      });
      continue;
    }
    const text = (await Bun.file(fullPath).text()).toLowerCase();
    const missing = markers.filter((m) => !text.includes(m.toLowerCase()));
    checks.push({
      name: relPath,
      status: missing.length === 0 ? "ok" : "warn",
      message: missing.length === 0 ? "aligned" : `missing markers: ${missing.join(", ")}`,
    });
  }

  for (const relPath of REQUIRED_FILES) {
    const fullPath = join(projectDir, relPath);
    checks.push({
      name: relPath,
      status: pathExists(fullPath) ? "ok" : "warn",
      message: pathExists(fullPath) ? "present" : "missing",
    });
  }

  const aligned = checks.every((c) => c.status === "ok");
  return { applicable, aligned, checks };
}
