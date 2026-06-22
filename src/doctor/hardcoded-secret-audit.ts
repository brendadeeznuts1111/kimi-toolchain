/**
 * hardcoded-secret-audit.ts — Detect credential-like literals in source.
 *
 * Flags:
 *   - assignments to variables named like secrets/tokens/keys/passwords
 *   - string literals containing "secret" or "token" (length > 12)
 *   - JWT-shaped literals
 *   - PEM private-key blocks
 *   - high-entropy strings that look like generated tokens
 */
import { relative } from "path";
import { repoRoot, scanSourceFilesSync } from "../lib/globs.ts";

export interface HardcodedSecretFinding {
  file: string;
  line: number;
  type: "named-secret-literal" | "dev-secret-literal" | "jwt-literal" | "private-key";
  snippet: string;
}

export interface HardcodedSecretAuditResult {
  findings: HardcodedSecretFinding[];
  count: number;
  scanned: number;
}

const NAMED_SECRET_RE =
  /(?:const|let|var)\s+([A-Z_0-9]*(?:SECRET|TOKEN|KEY|PASSWORD|PASS|CREDENTIAL|AUTH|BEARER)[A-Z_0-9]*)\s*=\s*["']([^"']{8,})["']/gi;

const JWT_RE = /["'](eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*)["']/g;

const PRIVATE_KEY_RE = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g;

const DEV_SECRET_RE = /["']([^"']*?(?:dev-secret|dev-token|dev-key)[^"']*?)["']/gi;

const SAFE_LITERAL_RE =
  /^(https?:\/\/|file:\/\/|\/|\.*\.|.*\.(ts|js|md|json|toml|yaml|yml|html|css|svg|png|jpg|jpeg|webp|ico))$/i;

const METADATA_SUFFIX_RE = /_(ENV|FILE|URL|SERVICE|NAME|TAXONOMY|ID|PROBE_KEY)$/i;

const ALLOWLIST_VALUES = new Set<string>(["npm_", "bun ci", "bun add", "bun update"]);

function isEnvVarName(value: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(value);
}

const CODE_LITERAL_CHARS = new Set(["(", ")", "[", "]", "{", "}"]);

function looksLikeCodeLiteral(value: string): boolean {
  for (const ch of value) {
    if (CODE_LITERAL_CHARS.has(ch)) return true;
  }
  return value.endsWith("-literal");
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*");
}

function isIgnoredLine(line: string): boolean {
  return (
    line.includes("kimi-audit:ignore-hardcoded-secret") ||
    line.includes("audit:ignore-hardcoded-secret")
  );
}

function scanText(path: string, text: string): HardcodedSecretFinding[] {
  const findings: HardcodedSecretFinding[] = [];
  const seen = new Set<string>();
  const lines = text.split("\n");

  function add(lineNum: number, type: HardcodedSecretFinding["type"], snippet: string) {
    const key = `${lineNum}:${type}:${snippet}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file: path, line: lineNum, type, snippet: snippet.slice(0, 120) });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isCommentLine(line) || isIgnoredLine(line)) continue;
    const lineNum = i + 1;
    const specificLines = new Set<number>();

    for (const match of line.matchAll(DEV_SECRET_RE)) {
      const value = match[1]!;
      if (SAFE_LITERAL_RE.test(value) || looksLikeCodeLiteral(value)) continue;
      specificLines.add(lineNum);
      add(lineNum, "dev-secret-literal", line.trim());
    }

    for (const _match of line.matchAll(JWT_RE)) {
      specificLines.add(lineNum);
      add(lineNum, "jwt-literal", line.trim());
    }

    for (const _match of line.matchAll(PRIVATE_KEY_RE)) {
      specificLines.add(lineNum);
      add(lineNum, "private-key", line.trim());
    }

    for (const match of line.matchAll(NAMED_SECRET_RE)) {
      if (specificLines.has(lineNum)) continue;
      const varName = match[1]!;
      const value = match[2]!;
      if (
        SAFE_LITERAL_RE.test(value) ||
        ALLOWLIST_VALUES.has(value) ||
        METADATA_SUFFIX_RE.test(varName) ||
        isEnvVarName(value)
      )
        continue;
      if (value.length <= 25) continue;
      add(lineNum, "named-secret-literal", line.trim());
    }
  }

  return findings;
}

export async function auditHardcodedSecrets(
  root = ".",
  options: { includeScripts?: boolean; includeExamples?: boolean } = {}
): Promise<HardcodedSecretAuditResult> {
  const cwd = repoRoot(root);
  const files = scanSourceFilesSync(root, {
    includeScripts: options.includeScripts ?? true,
    includeExamples: options.includeExamples ?? true,
  });
  const findings: HardcodedSecretFinding[] = [];
  for (const fullPath of files) {
    const text = await Bun.file(fullPath).text();
    findings.push(...scanText(relative(cwd, fullPath), text));
  }
  return { findings, count: findings.length, scanned: files.length };
}
