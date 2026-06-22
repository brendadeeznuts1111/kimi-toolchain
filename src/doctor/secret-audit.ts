/**
 * secret-audit.ts — Audit raw environment access outside the com.herdr registry.
 */
import { relative } from "path";
import { repoRoot, scanSourceFilesSync } from "../lib/globs.ts";

export interface SecretAuditFinding {
  file: string;
  line: number;
  type: "Bun.env" | "process.env";
  key: string;
  snippet: string;
}

export interface SecretAuditResult {
  findings: SecretAuditFinding[];
  count: number;
  scanned: number;
  skippedByCache: number;
}

export interface SecretAuditOptions {
  includeScripts?: boolean;
  includeExamples?: boolean;
  useCache?: boolean;
  cachePath?: string;
}

const ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "PWD",
  "OLDPWD",
  "NODE_ENV",
  "CI",
  "BUN_ENV",
  "TERM",
  "TERMINAL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XPC_FLAGS",
  "XPC_SERVICE_NAME",
  "SSH_AUTH_SOCK",
  "TZ",
  "EDITOR",
  "VISUAL",
  "HOSTNAME",
  "PLATFORM",
  "COLORTERM",
  "SHLVL",
  "KIMI_TEST_HOME",
  "KIMI_PROJECT_ROOT",
  "KIMI_QUIET",
  "BUN_INSTALL_CACHE_DIR",
  "BUN_INSTALL_GLOBAL_DIR",
  "BUN_INSTALL_BIN_DIR",
  "API_URL",
  "NO_COLOR",
  "PORT",
  "DX_GLOBAL_CONFIG",
  "ARTIFACT_IDENTITY_MAX_LEN",
  "C_INCLUDE_PATH",
  "LIBRARY_PATH",
  "EXAMPLES_DASHBOARD_URL",
  "HERDR_DASHBOARD_URL",
  "HERDR_EXAMPLES_DASHBOARD_URL",
  "HERDR_SESSION",
  "HERDR_SESSION_ID",
  "HERDR_WORKSPACE_ID",
  "HERDR_DOCTOR_PANE_ID",
  "HERDR_ORCHESTRATOR_INTERVAL",
  "HERDR_CONTEXT_JSON_FILE",
  "HERDR_CONTEXT_FILE",
  "HERDR_SOCKET_PATH",
  "HERDR_SOCKET_TRANSPORT",
  "HERDR_SOCKET_TLS",
  "HERDR_SOCKET_TEST_RECONNECT_MS",
  "HERDR_PANE_ID",
  "HERDR_ENV",
  "GITLAB_CI",
  "GITHUB_SHA",
  "GITHUB_BASE_REF",
  "GITHUB_EVENT_BEFORE",
  "GITHUB_OUTPUT",
  "GITHUB_EVENT_NAME",
  "GITHUB_ACTIONS",
]);

// Keys that look like credentials when accessed via dot notation (e.g. process.env.API_TOKEN).
const SECRET_KEY_RE = /_(?:TOKEN|SECRET|KEY|PASSWORD|PASS|CREDENTIAL|AUTH|BEARER)$/i;

const ENV_RES = [
  { type: "Bun.env" as const, re: /Bun\.env(?:\[["']([^"']+)["']\]|\.\s*([A-Z_][A-Z0-9_]*))/g },
  {
    type: "process.env" as const,
    re: /process\.env(?:\[["']([^"']+)["']\]|\.\s*([A-Z_][A-Z0-9_]*))/g,
  },
];

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*");
}

function shouldFlagKey(key: string, isStringAccess: boolean): boolean {
  if (!key || ALLOWLIST.has(key) || key.startsWith("KIMI_") || key.startsWith("BUN_")) return false;
  if (key.startsWith("com.herdr.")) return false;
  if (key.startsWith("HERDR_SSH_")) return false;
  if (isStringAccess) return true;
  return SECRET_KEY_RE.test(key);
}

function scanText(path: string, text: string): SecretAuditFinding[] {
  const out: SecretAuditFinding[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isCommentLine(line)) continue;

    for (const { type, re } of ENV_RES) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        const key = m[1] ?? m[2] ?? "";
        const isStringAccess = m[0].includes("[");
        if (!shouldFlagKey(key, isStringAccess)) continue;
        out.push({ file: path, line: i + 1, type, key, snippet: line.trim().slice(0, 120) });
      }
    }
  }
  return out;
}

async function collectGlobSourceFiles(
  root: string,
  globPatterns: readonly string[]
): Promise<string[]> {
  const cwd = repoRoot(root);
  const seen = new Set<string>();
  for (const pattern of globPatterns) {
    for (const path of new Bun.Glob(pattern).scanSync({
      cwd,
      absolute: true,
      onlyFiles: true,
    })) {
      if (!/\.(?:ts|tsx)$/.test(path)) continue;
      seen.add(path);
    }
  }
  return [...seen].sort();
}

export async function auditSecretLeaksInGlob(
  root = ".",
  globPatterns: readonly string[]
): Promise<SecretAuditResult> {
  const cwd = repoRoot(root);
  const files = await collectGlobSourceFiles(root, globPatterns);
  const findings: SecretAuditFinding[] = [];
  for (const fullPath of files) {
    const text = await Bun.file(fullPath).text();
    findings.push(...scanText(relative(cwd, fullPath), text));
  }
  return { findings, count: findings.length, scanned: files.length, skippedByCache: 0 };
}

export async function auditSecretLeaks(
  root = ".",
  options: SecretAuditOptions = {}
): Promise<SecretAuditResult> {
  const cwd = repoRoot(root);
  const files = scanSourceFilesSync(root, {
    includeScripts: options.includeScripts ?? true,
    includeExamples: options.includeExamples ?? true,
  });
  const findings: SecretAuditFinding[] = [];
  for (const fullPath of files) {
    const text = await Bun.file(fullPath).text();
    findings.push(...scanText(relative(cwd, fullPath), text));
  }
  return { findings, count: findings.length, scanned: files.length, skippedByCache: 0 };
}
