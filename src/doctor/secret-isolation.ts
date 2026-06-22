/**
 * secret-isolation.ts — Verify CLI bins resolve secrets before spawning child processes.
 */
import { scanBinTsSync } from "../lib/globs.ts";

export interface SecretIsolationIssue {
  file: string;
  severity: "error" | "warn";
  message: string;
}

export interface SecretIsolationResult {
  issues: SecretIsolationIssue[];
  errorCount: number;
}

export const EXEMPT_BINS = new Set([
  "kimi-debug.ts",
  "kimi-snapshot.ts",
  "kimi-bake.ts",
  "kimi-identity.ts",
  "kimi-githooks.ts",
  "kimi-context-gen.ts",
  "kimi-secrets.ts",
  "kimi-orphan-kill.ts",
  "kimi-trace.ts",
  "kimi-why.ts",
  "kimi-memory.ts",
  "kimi-decision.ts",
  "kimi-error.ts",
  "kimi-capabilities.ts",
  "kimi-cleanup-legacy.ts",
  "kimi-config.ts",
  "kimi-contract.ts",
  "kimi-dashboard-mcp.ts",
  "kimi-dashboard.ts",
  "kimi-mcp.ts",
  "kimi-resource-governor.ts",
  "kimi-toolchain.ts",
  "kimi-cloudflare-access.ts",
  "kimi-heal.ts",
  "kimi-deep-audit.ts",
  "herdr-orchestrator.ts",
  "unified-shell-bridge.ts",
]);

function binRelativePath(absolutePath: string): string {
  const marker = "/src/bin/";
  const idx = absolutePath.lastIndexOf(marker);
  if (idx >= 0) return `src/bin/${absolutePath.slice(idx + marker.length)}`;
  return absolutePath.split("/").slice(-2).join("/");
}

function scanBinText(file: string, text: string): SecretIsolationIssue[] {
  const hasSpawn =
    text.includes("Bun.spawn") ||
    text.includes("Bun.$") ||
    text.includes("$`") ||
    text.includes("runTool(");

  const usesToolRunner =
    /from\s+["'][^"']*tool-runner/.test(text) &&
    (text.includes("runTool(") ||
      text.includes("invokeTool(") ||
      text.includes("spawnBun(") ||
      text.includes("invokeCommand("));

  const hasResolver =
    text.includes("resolveDevSecrets") ||
    text.includes("ensureDevSecretsResolved") ||
    text.includes("resolveGithubEnv") ||
    text.includes("resolveNpmEnv") ||
    text.includes("resolveR2Env") ||
    text.includes("resolveDiscordEnv") ||
    text.includes("resolveTelegramEnv") ||
    usesToolRunner;

  if (hasSpawn && !hasResolver) {
    return [
      {
        file: binRelativePath(file),
        severity: "error",
        message: "spawns child processes but never calls resolveDevSecrets() or any resolver",
      },
    ];
  }

  return [];
}

export async function auditBinSecretIsolation(
  file: string,
  _root = "."
): Promise<SecretIsolationIssue[]> {
  const baseName = file.split("/").pop() ?? file;
  if (EXEMPT_BINS.has(baseName)) return [];
  const text = await Bun.file(file).text();
  return scanBinText(file, text);
}

export async function checkSecretIsolation(root = "."): Promise<SecretIsolationResult> {
  const issues: SecretIsolationIssue[] = [];

  for (const file of scanBinTsSync(root)) {
    issues.push(...(await auditBinSecretIsolation(file, root)));
  }

  return {
    issues,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
  };
}

export async function auditSecretIsolation(root = "."): Promise<SecretIsolationResult> {
  return checkSecretIsolation(root);
}
