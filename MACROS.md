# Bun Macros — Build-Time Code Execution

This project uses [Bun macros](https://bun.com/docs/bundler/macros) to execute functions at **build time** and inline their return values as static literals in the bundle. This eliminates runtime overhead for color conversion, file reading, network requests, and documentation parsing.

## How Macros Work

Macros are regular TypeScript functions imported with the `with { type: "macro" }` import attribute:

```ts
import { color } from "bun" with { type: "macro" };

const primary = color("#007acc", "css"); // becomes "#007acc" in the bundle
```

After bundling with `bun build`, the `color()` call is gone — only the static string remains. The function executes in Bun's transpiler during the visiting phase, before plugins and AST generation.

### Key Constraints

- **Arguments must be statically known** — you can't pass runtime variables to macro functions. Literal strings, numbers, and results of other macro calls are allowed.
- **Return values must be serializable** — JSON-compatible data (strings, numbers, booleans, arrays, objects, null). TypedArrays are not supported in Bun 1.3.14 (use `btoa()` to return base64 strings instead).
- **Macros can be async** — Bun's transpiler awaits Promises returned by macro functions.
- **Macros cannot run from `node_modules`** — for security, only application code can invoke macros.

## Existing Macros

### Color Theming

| File                      | Type     | Purpose                                                                            |
| ------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `src/lib/theme.ts`        | Consumer | `Bun.color` macro → static CSS strings (`"red"`, `"#f60"`, etc.)                   |
| `src/lib/theme-tokens.ts` | Source   | Canonical hex color definitions (25 tokens across 4 categories)                    |
| `scripts/build-theme.ts`  | Runtime  | CLI-driven CSS generation using runtime `Bun.color()` (for `--format` flexibility) |

**Usage:**

```ts
import { theme, cssVars } from "./theme.ts";
console.log(theme.severity.critical); // "red" (static in bundle)
```

### Build Metadata

| File                           | Type     | Purpose                                                                                                       |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------- |
| `src/lib/build-info-macros.ts` | Source   | `getGitHash()`, `getGitBranch()`, `getBuildTime()`, `getPackageVersion()`, `getBunVersion()`, `getPlatform()` |
| `src/lib/build-info.ts`        | Consumer | `buildInfo` object, `buildSummary`, `buildBanner` — all resolved at build time                                |

**Usage:**

```ts
import { buildInfo, buildBanner } from "./build-info.ts";
console.log(buildInfo.gitHash); // "f52d9c0b" (static in bundle)
```

### Feature Flags

| File                             | Type    | Purpose                                                                           |
| -------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `src/lib/feature-flag-macros.ts` | Source  | `isScannerEnabled()`, `isDashboardEnabled()`, etc. — reads env vars at build time |
| `src/lib/feature-flags.ts`       | Runtime | `features` object + `featureInfo` metadata (reads env vars at module load)        |

**Usage with dead code elimination:**

```ts
import { isDashboardEnabled } from "./feature-flag-macros.ts" with { type: "macro" };

if (isDashboardEnabled()) {
  // This entire block is eliminated if DASHBOARD_ENABLED != 1 at build time
}
```

### CLI Help Text

| File                            | Type     | Purpose                                                                                        |
| ------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `src/lib/cli-help.ts`           | Consumer | Help text for `kimi-secrets`, `kimi-guardian`, and general help — embeds build stamp via macro |
| `src/lib/cli-help-generator.ts` | Consumer | Combines `Bun.color` macro + embedded docs + build info for colored terminal output            |

**Usage:**

```ts
import { printHelp } from "./cli-help-generator.ts";
printHelp("kimi-secrets"); // colored, macro-generated help
```

### Embedded Documentation (HTMLRewriter)

| File                       | Type     | Purpose                                                                                                                 |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/lib/readme-macros.ts` | Source   | `extractReadmeSection(file, section)` — reads markdown, converts via `Bun.markdown.html()`, extracts via `HTMLRewriter` |
| `src/lib/embedded-docs.ts` | Consumer | `installGuide`, `projectOverview`, `readmeHeadings` — README sections as static strings                                 |

**Usage:**

```ts
import { installGuide } from "./embedded-docs.ts";
console.log(installGuide); // full install instructions (static in bundle)
```

### Dependency Versions (Async Fetch)

| File                             | Type     | Purpose                                                                                      |
| -------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `src/lib/npm-registry-macros.ts` | Source   | `getLatestVersion(pkg)` — async `fetch()` to npm registry at build time                      |
| `src/lib/dependency-versions.ts` | Consumer | `dependencyVersions` object with latest versions of `effect`, `bun`, `typescript`, `js-yaml` |

**Usage:**

```ts
import { dependencyVersions } from "./dependency-versions.ts";
console.log(dependencyVersions.effect); // "3.21.4" (static in bundle)
```

### Embedded Assets (Base64)

| File                            | Type     | Purpose                                                |
| ------------------------------- | -------- | ------------------------------------------------------ |
| `src/lib/asset-embed-macros.ts` | Source   | `embedAsset(path)` — reads file, returns base64 string |
| `src/lib/embedded-assets.ts`    | Consumer | `shieldIcon` (base64), `shieldIconDataUri` (data: URI) |
| `src/assets/shield.svg`         | Asset    | SVG shield icon                                        |

**Usage:**

```ts
import { shieldIconDataUri } from "./embedded-assets.ts";
// Use in HTML: <img src={shieldIconDataUri} />
```

## Adding a New Macro

1. **Create the macro source file** (e.g., `src/lib/my-macro.ts`):

   ```ts
   export function myMacro(literalArg: string): string {
     // Perform build-time work (file reads, fetch, spawnSync, etc.)
     return "result";
   }
   ```

2. **Create the consumer module** (e.g., `src/lib/my-consumer.ts`):

   ```ts
   import { myMacro } from "./my-macro.ts" with { type: "macro" };
   export const result = myMacro("static-arg");
   ```

3. **Verify the macro inlines correctly:**

   ```bash
   bun build src/lib/my-consumer.ts --outdir dist
   grep "myMacro" dist/my-consumer.js  # should return nothing
   ```

4. **Add tests** in `test/my-macro.unit.test.ts`.

## The `--no-macros` Flag

Bun supports a `--no-macros` flag that is intended to disable macro execution. However, in **Bun 1.3.14**, this flag does not produce build errors — macros still execute and values are still inlined. The flag is accepted but has no effect.

If a future Bun version changes this behavior, update `test/macros-no-macros.unit.test.ts` to expect build failures instead of successful builds.

## CLI Integration

Both `kimi-secrets` and `kimi-guardian` use `printHelp()` from `cli-help-generator.ts` for their `--help` / `-h` flags:

```ts
// src/bin/kimi-secrets.ts
import { printHelp } from "../lib/cli-help-generator.ts";

async function main(): Promise<number> {
  if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
    printHelp("kimi-secrets");
    return 0;
  }
  // ... command handling
}
```

The help output includes:
- Tool name and version (from `build-info.ts` macro)
- Available commands and options
- Usage examples
- For `general` help: table of contents and install guide (from `embedded-docs.ts` macro)
- ANSI color codes (from `Bun.color` macro) for terminal readability

## Build Verification

To verify all macros are working:

```bash
# Build each macro consumer and check for inlined values
bun build src/lib/theme.ts --outdir dist
bun build src/lib/build-info.ts --outdir dist
bun build src/lib/cli-help-generator.ts --outdir dist
bun build src/lib/embedded-assets.ts --outdir dist
bun build src/lib/dependency-versions.ts --outdir dist
bun build src/lib/embedded-docs.ts --outdir dist

# Verify no runtime calls remain
grep -r "spawnSync\|HTMLRewriter\|Bun.markdown\|fetch(" dist/  # should return nothing
```

## Test Coverage

| Test File                              | Tests   | Covers                                              |
| -------------------------------------- | ------- | --------------------------------------------------- |
| `test/theme-tokens.unit.test.ts`       | 19      | Token definitions, CSS generation, arg parsing      |
| `test/theme.unit.test.ts`              | 20      | Theme module (color macro output)                   |
| `test/macros.unit.test.ts`             | 36      | Build info, CLI help, feature flags                 |
| `test/macros-advanced.unit.test.ts`    | 18      | Embedded assets, dependency versions, embedded docs |
| `test/macros-no-macros.unit.test.ts`   | 7       | `--no-macros` flag behavior                         |
| `test/cli-help-generator.unit.test.ts` | 13      | CLI help generator output                           |
| **Total**                              | **113** |                                                     |
