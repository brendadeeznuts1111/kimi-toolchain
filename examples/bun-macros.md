---
title: "Bun Macros — Practical Examples"
tags: [macros, bun, build-time, examples, color, fetch, htmlrewriter, base64]
category: "examples"
priority: high
---

<!-- status: stable; owner: @nolarose; review-date: 2026-07-21 -->

# Bun Macros — Practical Examples

## Description

This document shows how Bun macros are used throughout kimi-toolchain to eliminate runtime overhead by executing functions at build time.

See [MACROS.md](../MACROS.md) for the full API reference.

## What Are Macros?

Macros are regular TypeScript functions that execute during `bun build`. Their return values are inlined as static literals in the bundle — the function calls themselves are removed.

```ts
// Source code
import { color } from "bun" with { type: "macro" };
const primary = color("#007acc", "css");

// Bundled output
const primary = "#007acc";
```

<!-- #find:macro-color-theme -->
## Pattern 1: Color Theming

Resolve hex colors to CSS/ANSI strings at build time using `Bun.color`:

```ts
// src/lib/theme.ts
import { color } from "bun" with { type: "macro"";
import { tokens } from "./theme-tokens.ts";

export const theme = {
  severity: {
    critical: color(tokens.severity.critical, "css"),  // → "red"
    high: color(tokens.severity.high, "css"),          // → "#f60"
  },
} as const;
```

**In the bundle:**
```js
var theme = { severity: { critical: "red", high: "#f60" } };
```

No `Bun.color()` call, no `tokens` import — just static strings.

**Generate a CSS file:**

```bash
bun run scripts/build-theme.ts --outdir dist --format css
# Produces dist/theme.css with :root { --severity-critical: red; ... }
```

<!-- #find:macro-build-metadata -->
## Pattern 2: Build Metadata

Embed git hash, branch, build time, and version at build time:

```ts
// src/lib/build-info.ts
import { getGitHash, getGitBranch, getBuildTime, getPackageVersion } from "./build-info-macros.ts" with { type: "macro" };

export const buildInfo = {
  gitHash: getGitHash(),       // → "f52d9c0b"
  gitBranch: getGitBranch(),   // → "feat/bun-secrets"
  buildTime: getBuildTime(),   // → "2026-06-22T00:50:22.829Z"
  version: getPackageVersion(),// → "1.0.0"
};
```

**Use in CLI banner:**
```ts
import { buildBanner } from "./build-info.ts";
console.log(buildBanner);
// kimi-secrets v1.0.0 (f52d9c0b @ 2026-06-22T00:50:22.829Z)
```

<!-- #find:macro-feature-flags -->
## Pattern 3: Feature Flags with Dead Code Elimination

Compile-time feature flags enable entire code blocks to be removed from the bundle:

```ts
// src/lib/feature-flag-macros.ts
import { isDashboardEnabled } from "./feature-flag-macros.ts" with { type: "macro" };

if (isDashboardEnabled()) {
  // If DASHBOARD_ENABLED != "1" at build time,
  // this entire block is eliminated from the bundle
  import { startDashboard } from "./dashboard.ts";
  startDashboard();
}
```

**With `DASHBOARD_ENABLED=1`:**
```js
if (true) { /* dashboard code */ }
// After minification: dashboard code runs
```

**Without `DASHBOARD_ENABLED`:**
```js
if (false) { /* dashboard code */ }
// After minification: block removed entirely
```

<!-- #find:macro-async-fetch -->
## Pattern 4: Async Fetch (npm Registry)

Fetch data from external APIs at build time. The `fetch()` call happens during bundling — the result is inlined:

```ts
// src/lib/dependency-versions.ts
import { getLatestVersion } from "./npm-registry-macros.ts" with { type: "macro" };

export const dependencyVersions = {
  effect: getLatestVersion("effect"),       // → "3.21.4"
  bun: getLatestVersion("bun"),             // → "1.3.14"
  typescript: getLatestVersion("typescript"),// → "6.0.3"
};
```

**In the bundle:**
```js
var dependencyVersions = { effect: "3.21.4", bun: "1.3.14", typescript: "6.0.3" };
```

No `fetch()`, no network calls at runtime.

<!-- #find:macro-htmlrewriter -->
## Pattern 5: HTMLRewriter for Documentation Extraction

Parse Markdown files at build time using `Bun.markdown.html()` + `HTMLRewriter`:

```ts
// src/lib/embedded-docs.ts
import { extractReadmeSection } from "./readme-macros.ts" with { type: "macro" };

export const installGuide = extractReadmeSection("./README.md", "Install");
// → "bun install -g github:brendadeeznuts1111/kimi-toolchain\n..."
```

**In the bundle:**
```js
var installGuide = "bun install -g github:brendadeeznuts1111/kimi-toolchain\n...";
```

No `Bun.markdown`, no `HTMLRewriter`, no file reads at runtime.

<!-- #find:macro-base64-assets -->
## Pattern 6: Base64 Asset Embedding

Read binary files (SVGs, fonts, icons) at build time and inline as base64:

```ts
// src/lib/embedded-assets.ts
import { embedAsset } from "./asset-embed-macros.ts" with { type: "macro" };

export const shieldIcon = embedAsset("./src/assets/shield.svg");
// → "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmci..."

export const shieldIconDataUri = `data:image/svg+xml;base64,${shieldIcon}`;
```

**Use in HTML:**
```html
<img src={shieldIconDataUri} alt="Shield" />
```

<!-- #find:macro-cli-help -->
## Pattern 7: CLI Help with Colored Output

Combine multiple macros (color, build info, embedded docs) for rich CLI help:

```ts
// src/lib/cli-help-generator.ts
import { color } from "bun" with { type: "macro" };
import { installGuide, tableOfContents } from "./embedded-docs.ts";
import { buildInfo } from "./build-info.ts";

const c = {
  title: color("#007acc", "ansi"),   // → ANSI escape code
  section: color("#00aaff", "ansi"),
  reset: "\x1b[0m",
};

export function getHelpText(tool: string): string {
  return `${c.title}${tool}${c.reset} v${buildInfo.version}\n...`;
}
```

**Wired into CLI tools:**
```bash
kimi-secrets --help    # prints colored, macro-generated help
kimi-guardian --help    # prints colored, macro-generated help
```

<!-- #find:macro-verification -->
## Verification

Verify macros are inlined correctly:

```bash
# Build and check for inlined values
bun build src/lib/theme.ts --outdir dist
grep "color(" dist/theme.js  # should return nothing

bun build src/lib/dependency-versions.ts --outdir dist
grep "fetch(" dist/dependency-versions.js  # should return nothing

# Full CLI build — verify zero macro calls remain
bun build src/bin/kimi-secrets.ts --outdir dist --target bun
grep -E "(getGitHash|extractReadmeSection|embedAsset|getLatestVersion)" dist/kimi-secrets.js
# should return nothing
```

<!-- #find:macro-adding-new -->
## Adding Your Own Macro

1. Create a macro source file:

```ts
// src/lib/my-macro.ts
export function getApiVersion(): string {
  return "v2.1.0";
}
```

2. Create a consumer module:

```ts
// src/lib/my-consumer.ts
import { getApiVersion } from "./my-macro.ts" with { type: "macro" };
export const apiVersion = getApiVersion();
```

3. Verify inlining:

```bash
bun build src/lib/my-consumer.ts --outdir dist
cat dist/my-consumer.js
# Should show: var apiVersion = "v2.1.0";
```

4. Add tests in `test/my-macro.unit.test.ts`.

## Related

- [MACROS.md](../MACROS.md) — Full Bun macros API reference
- [examples/secrets-and-identity.md](secrets-and-identity.md) — Secrets & identity usage guide
- [docs/scanner-pipeline-spec.md](../docs/scanner-pipeline-spec.md) — Scanner pipeline specification
