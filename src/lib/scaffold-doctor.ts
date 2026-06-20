/**
 * Scaffold completeness checks for kimi-fix doctor.
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { REQUIRED_PACKAGE_SCRIPTS } from "./scaffold-templates.ts";
import type { HealthCheck as DoctorCheck } from "./health-check.ts";
import { safeToml } from "./utils.ts";

const DEFAULT_WORKFLOW_PATH = ".github/workflows/ci.yml";
const CI_DISABLED_MESSAGE =
  "disabled (server CI unavailable) — enforcement via pre-push hooks + ci:local";

interface DxCiConfig {
  workflowPath: string;
  explicitlyDisabled: boolean;
  pathImpliesDisabled: boolean;
}

async function readDxCiConfig(projectDir: string): Promise<DxCiConfig> {
  const dxPath = join(projectDir, "dx.config.toml");
  let workflowPath = DEFAULT_WORKFLOW_PATH;
  let explicitlyDisabled = false;

  if (pathExists(dxPath)) {
    const parsed = safeToml<Record<string, unknown> | null>(await Bun.file(dxPath).text(), null);
    if (parsed) {
      const github = parsed.github;
      if (github && typeof github === "object") {
        const g = github as Record<string, unknown>;
        if (typeof g.workflow === "string" && g.workflow.length > 0) {
          workflowPath = g.workflow;
        }
        const ci = g.ci;
        if (ci && typeof ci === "object" && (ci as Record<string, unknown>).disabled === true) {
          explicitlyDisabled = true;
        }
      }
    }
  }

  return {
    workflowPath,
    explicitlyDisabled,
    pathImpliesDisabled: workflowPath.includes("workflows-disabled"),
  };
}

async function checkCiWorkflow(projectDir: string): Promise<DoctorCheck> {
  const { workflowPath, explicitlyDisabled, pathImpliesDisabled } =
    await readDxCiConfig(projectDir);
  const present = pathExists(join(projectDir, workflowPath));
  const ciDisabled = pathImpliesDisabled || explicitlyDisabled;

  if (present) {
    return {
      name: "ci.yml",
      status: "ok",
      message: `present at ${workflowPath}`,
      fixable: false,
    };
  }

  if (ciDisabled) {
    return {
      name: "ci.yml",
      status: "ok",
      message: CI_DISABLED_MESSAGE,
      fixable: false,
    };
  }

  return {
    name: "ci.yml",
    status: "warn",
    message: "missing — run kimi-fix",
    fixable: true,
  };
}

export async function checkScaffold(projectDir: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  const fileChecks: Array<{ name: string; rel: string }> = [
    { name: "README.md", rel: "README.md" },
    { name: "CONTEXT.md", rel: "CONTEXT.md" },
    { name: "AGENTS.md", rel: "AGENTS.md" },
    { name: "CODE_REFERENCES.md", rel: "CODE_REFERENCES.md" },
    { name: "tsconfig.json", rel: "tsconfig.json" },
    { name: "bunfig.toml", rel: "bunfig.toml" },
    { name: "dx.config.toml", rel: "dx.config.toml" },
    { name: "mcp.json", rel: ".kimi-code/mcp.json" },
    { name: "check.ts", rel: "scripts/check.ts" },
    { name: "oxfmtrc", rel: ".oxfmtrc.json" },
    { name: "oxlintrc", rel: ".oxlintrc.json" },
  ];

  for (const { name, rel } of fileChecks) {
    const present = pathExists(join(projectDir, rel));
    checks.push({
      name,
      status: present ? "ok" : "warn",
      message: present ? "present" : "missing — run kimi-fix",
      fixable: !present,
    });
  }

  checks.push(await checkCiWorkflow(projectDir));

  const pkgPath = join(projectDir, "package.json");
  if (!pathExists(pkgPath)) {
    checks.push({
      name: "package.json",
      status: "error",
      message: "missing",
      fixable: false,
    });
    return checks;
  }

  try {
    const pkg = (await Bun.file(pkgPath).json()) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts || {};
    const missingScripts = REQUIRED_PACKAGE_SCRIPTS.filter((s) => !scripts[s]);
    checks.push({
      name: "package-scripts",
      status: missingScripts.length === 0 ? "ok" : "warn",
      message:
        missingScripts.length === 0
          ? "quality scripts defined"
          : `missing: ${missingScripts.join(", ")}`,
      fixable: missingScripts.length > 0,
    });
  } catch {
    checks.push({
      name: "package.json",
      status: "error",
      message: "invalid JSON",
      fixable: false,
    });
  }

  return checks;
}
