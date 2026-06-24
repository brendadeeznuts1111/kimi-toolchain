#!/usr/bin/env bun
/**
 * Shared ast-grep inline rules for naming convention lint gates.
 */

export const ACRONYMS = [
  "MCP",
  "API",
  "URL",
  "JSON",
  "HTTP",
  "JWT",
  "CSRF",
  "SSE",
  "DB",
  "ID",
  "UUID",
  "HTML",
  "CSS",
  "SQL",
  "CLI",
  "GUI",
  "CPU",
  "RAM",
  "DNS",
  "TCP",
  "TLS",
  "SSL",
  "SSH",
  "FTP",
  "S3",
  "NPM",
  "DOM",
  "SVG",
  "CSV",
  "TSV",
  "YAML",
  "TOML",
];

// Web-standard / Bun API names that cannot be renamed.
export const EXEMPT_PATTERNS = [
  "^[A-Z_][A-Z0-9_]*$",
  "^(URLPattern|URLSearchParams|ShadowRealm|randomUUIDv7|pathToFileURL|fileURLToPath|SQLQueryBindings|S3Client|S3Bucket|S3File)$",
  "^HTML[A-Z].*$",
  "^SVG[A-Z].*$",
  "^CSS[A-Z].*$",
  "^DOM[A-Z].*$",
];

export const NAMING_RULES = `
id: acronym-casing
language: typescript
message: Identifier uses uppercase acronym; use word-case (Api, Json, Url, etc.)
severity: error
rule:
  kind: identifier
  regex: (${ACRONYMS.join("|")})
  not:
    any:
${EXEMPT_PATTERNS.map((p) => `      - regex: ${p}`).join("\n")}
---
id: type-predicate-naming
language: typescript
message: Function returns a type predicate; rename to start with "is" (or "assert" for assertions)
severity: error
rule:
  any:
    - pattern: 'function $NAME($$$ARGS): $$$LEFT is $$$RIGHT { $$$BODY }'
    - pattern: 'function $NAME($$$ARGS): asserts $$$LEFT is $$$RIGHT { $$$BODY }'
    - pattern: 'const $NAME = ($$$ARGS): $$$LEFT is $$$RIGHT => $$$BODY'
    - pattern: 'const $NAME = ($$$ARGS): asserts $$$LEFT is $$$RIGHT => $$$BODY'
constraints:
  NAME:
    not:
      regex: ^(is|assert)
`;
