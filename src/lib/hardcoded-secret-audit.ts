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
import { repoRoot, scanSourceFilesSync } from "./globs.ts";

export interface HardcodedSecretFinding {
  file: string;
  line: number;
  type:
    | "named-secret-literal"
    | "dev-secret-literal"
    | "jwt-literal"
    | "private-key"
    | "private-key-block"
    | "known-secret-prefix"
    | "url-credentials"
    | "bearer-token"
    | "high-entropy-token";
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

const PRIVATE_KEY_BEGIN_RE = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/;
const PRIVATE_KEY_END_RE = /-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/;

const DEV_SECRET_RE = /["']([^"']*?(?:dev-secret|dev-token|dev-key)[^"']*?)["']/gi;

const KNOWN_SECRET_PREFIX_RE =
  /["']((?:sk-|ghp_|glpat-|pat-|AKIA|ASIA|GOOG|AIza|xoxb-|xoxa-|xapp-|rp_|live_)[A-Za-z0-9_\-/+]{16,})["']/g;

const URL_WITH_CREDENTIALS_RE = /["'](https?:\/\/[^"':\s]+:[^"'@\s]+@[^"'\s]+)["']/g;

const BEARER_HEADER_RE =
  /(?:Authorization\s*:\s*Bearer|Bearer\s+)["']?([A-Za-z0-9_\-.+/]{16,})["']?/gi;

const HIGH_ENTROPY_CANDIDATE_RE = /["']([A-Za-z0-9+/=_-]{32,})["']/g;

const BASE64_IMAGE_PREFIXES = new Set([
  "iVBORw0KGgo", // png
  "/9j/", // jpeg
  "R0lGOD", // gif
  "UklGR", // webp
  "PHN2Zy", // svg
  "PD94bW", // xml
]);

const SAFE_LITERAL_RE =
  /^(https?:\/\/|file:\/\/|\/|\.*\.|.*\.(ts|js|md|json|toml|yaml|yml|html|css|svg|png|jpg|jpeg|webp|ico))$/i;

const METADATA_SUFFIX_RE = /_(ENV|FILE|URL|SERVICE|NAME|TAXONOMY|ID|PROBE_KEY)$/i;

const ALLOWLIST_VALUES = new Set<string>(["npm_", "bun ci", "bun add", "bun update"]);

function isEnvVarName(value: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(value);
}

const CODE_LITERAL_CHARS = new Set(["(", ")", "[", "]", "{", "}"]);

function shannonEntropy(bytes: Uint8Array): number {
  const counts = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i++) counts[bytes[i]!]++;
  let entropy = 0;
  const n = bytes.length;
  for (let i = 0; i < 256; i++) {
    if (counts[i] === 0) continue;
    const p = counts[i]! / n;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isHighEntropyToken(value: string): boolean {
  if (value.length < 32) return false;
  for (const prefix of BASE64_IMAGE_PREFIXES) {
    if (value.startsWith(prefix)) return false;
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value)) return false;
  // Avoid hex-only hashes / ids
  if (!/[+/=_-]/.test(value)) return false;
  const bytes = new TextEncoder().encode(value);
  return shannonEntropy(bytes) > 4.5;
}

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

  let inPemBlock = false;
  let pemBlockStart = -1;
  const pemBlockLines = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    if (inPemBlock) {
      pemBlockLines.add(lineNum);
      if (PRIVATE_KEY_END_RE.test(line)) {
        add(pemBlockStart + 1, "private-key-block", lines[pemBlockStart]!.trim().slice(0, 120));
        inPemBlock = false;
        pemBlockStart = -1;
      }
      continue;
    }

    if (PRIVATE_KEY_BEGIN_RE.test(line)) {
      inPemBlock = true;
      pemBlockStart = i;
      pemBlockLines.add(lineNum);
      continue;
    }

    if (isCommentLine(line) || isIgnoredLine(line) || pemBlockLines.has(lineNum)) continue;
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

    for (const _match of line.matchAll(URL_WITH_CREDENTIALS_RE)) {
      specificLines.add(lineNum);
      add(lineNum, "url-credentials", line.trim());
    }

    for (const _match of line.matchAll(BEARER_HEADER_RE)) {
      specificLines.add(lineNum);
      add(lineNum, "bearer-token", line.trim());
    }

    for (const _match of line.matchAll(KNOWN_SECRET_PREFIX_RE)) {
      specificLines.add(lineNum);
      add(lineNum, "known-secret-prefix", line.trim());
    }

    for (const match of line.matchAll(HIGH_ENTROPY_CANDIDATE_RE)) {
      if (specificLines.has(lineNum)) continue;
      const value = match[1]!;
      if (!isHighEntropyToken(value)) continue;
      specificLines.add(lineNum);
      add(lineNum, "high-entropy-token", line.trim());
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

  // Unterminated PEM block — still report the header.
  if (inPemBlock && pemBlockStart >= 0) {
    add(pemBlockStart + 1, "private-key-block", lines[pemBlockStart]!.trim().slice(0, 120));
  }

  return findings;
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

export async function auditHardcodedSecretsInGlob(
  root = ".",
  globPatterns: readonly string[]
): Promise<HardcodedSecretAuditResult> {
  const cwd = repoRoot(root);
  const files = await collectGlobSourceFiles(root, globPatterns);
  const findings: HardcodedSecretFinding[] = [];
  for (const fullPath of files) {
    const text = await Bun.file(fullPath).text();
    findings.push(...scanText(relative(cwd, fullPath), text));
  }
  return { findings, count: findings.length, scanned: files.length };
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
