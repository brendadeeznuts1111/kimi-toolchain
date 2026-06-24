# Search / AI Discovery Ignore Stack

This repo uses a layered ripgrep ignore strategy so `rg`, the Grep tool, and editor
search stay focused on source files and never wander into caches, build artifacts,
or system directories.

## Layer 1 — Project `.rgignore`

**Path:** `.rgignore`  
**Scope:** repo root only  
**Purpose:** ignore artifacts _generated inside this repo_.

```ignore
# Dependencies
node_modules/

# Generated lockfiles & manifests
bun.lock
canonical-references.json
constants-manifest.json

# Generated documentation
CHANGELOG.md

# Build artifacts & caches
/.cache/
/dist/
*.bun-build
*.bun-build*
.bun-build*
*.tsbuildinfo
*.log

# Coverage & test reports
/coverage/
/reports/

# Machine profiles & baselines
/profiles/
.bun-native-baseline.json
/thresholds.json
*.cpuprofile

# Runtime / local state
/.kimi/
/.kimi-artifacts/
/.kimi-code/
/.kimi-test-locks/
/.devin/
/.grok/
/memory/
/var/
/guardian/
/governor/
/tools/
/.bun-create/
/.cursor/
/.codex/
/.reasonix/
/.ast-grep/
/.tmp/
/.tmp-*/
/.tmp-kimi-test-home/
.tmp-drift-*/
.tmp-test-*/
.tmp-path-align-*/

# SQLite databases
*.sqlite
*.sqlite-wal
*.sqlite-shm

# Compiled binaries & source maps
*.executable
cli
out.js
*.tar.gz
*.zip
*.wasm
*.node
*.map

# Compile-smoke & test temp
*.tmp-compile-smoke.ts
test-define-tmp.ts
.kimi-test-execve-child.ts

# Formatter temp
scripts/.fmt-*

# IDE / editor directories (not tracked; proactive)
.idea/
.vscode/
.fleet/
.zed/

# Merge / rebase conflict artifacts
*.orig
*.rej
*.bak

# Editor swap files
*.swp
*.swo

# Editor-specific agent rules (AGENTS.md is the canonical source)
CLAUDE.md
reasonix.toml

# Secrets / local env (excluded from Git; also hide from search)
.env
.env.local
.env.*.local
.env.test

# Stray home-dir snapshots (accidentally created inside repo root)
~/
Users/
~/.bun/
/.bun/install/cache/

# OS
.DS_Store
```

These paths are either generated locally (build artifacts, caches, test reports)
or tracked but noisy for search (lockfiles, generated manifests, changelogs).
Keeping them out of `rg` results speeds up AI-assisted discovery and avoids
surfacing irrelevant matches.

### Why root-relative directory patterns?

Directory patterns in `.rgignore` use a leading slash (`/memory/`, `/var/`,
`/guardian/`, `/governor/`, `/reports/`, `/profiles/`, `/tools/`, etc.). A leading slash
matches only the directory at the repo root, so ripgrep still indexes tracked
source directories that share the same name elsewhere in the tree, such as:

- `src/lib/memory/governor.ts`
- `src/guardian/perf-gate.ts`
- `test/guardian/`
- `examples/trading-workspace/var/`

Without the leading slash, `memory/` or `guardian/` would suppress matches at
any depth. Root-relative patterns keep the ignore list precise without hiding
tracked source code.

## Layer 2 — Global `~/.rgignore`

**Path:** `~/.rgignore`  
**Scope:** every `rg` invocation on this machine  
**Purpose:** ignore system/app caches and large language-specific directories.

```ignore
/Applications/
/Library/Caches/
~/Library/Caches/
~/.bun/install/cache/
~/.npm/
~/.cache/
~/.cargo/
~/.rustup/
~/.pyenv/
~/.asdf/
~/.conan/
~/.docker/
~/go/
~/.local/
```

Project searches should never crawl `/Applications` or home-directory caches even
if a symlink or parent-directory search accidentally points there.

## Layer 3 — `.gitignore` and `.oxfmtrc.json`

- `.gitignore` keeps untracked files out of Git.
- `.oxfmtrc.json` keeps the formatter from walking caches and build outputs.

These overlap with `.rgignore` but serve different tools. Keep all three in sync
when adding a new cache or artifact directory.

### Cross-file sync watchlist

| Pattern | `.rgignore` | `.gitignore` | `.oxfmtrc.json` | Notes |
|---|---|---|---|---|
| `node_modules/` | ✅ | ✅ | — | Too large to index or format |
| `bun.lock` | ✅ | — | ✅ | Tracked by Git, hidden from search/formatter |
| `canonical-references.json` | ✅ | — | ✅ | Generated manifest, tracked |
| `CHANGELOG.md` | ✅ | — | ✅ | Generated release notes, tracked |
| `examples/dashboard-urls.md` | — | — | ✅ | Generated dashboard docs (formatter-only; tracked & searchable) |
| `*.log` | ✅ | ✅ | ✅ | Ephemeral logs |
| `/.cache/` / `.cache` | ✅ | ✅ | ✅ | Formatter omits the leading slash |
| `.bun-native-baseline.json` | ✅ | ✅ | — | Baseline is machine-local |
| `*.cpuprofile` | ✅ | ✅ | — | Generated profiles |
| `.kimi-test-execve-child.ts` | ✅ | ✅ | ✅ | Formatter temp + test fixture helper |
| `reasonix.toml` | ✅ | ✅ | — | Local agent config |
| `/.grok/` | ✅ | — | — | Editor runtime (add to `.gitignore` if it appears on your machine) |
| `/tools/` | ✅ | ✅ | — | Live runtime tools directory |
| `*.tsbuildinfo` | ✅ | — | — | TypeScript incremental build cache |
| `*.map` | ✅ | — | — | Generated source maps |
| `*.orig` / `*.rej` / `*.bak` | ✅ | — | — | Merge/rebase conflict artifacts (proactive) |
| `*.swp` / `*.swo` | ✅ | — | — | Vim swap files (proactive) |
| `.idea/` / `.vscode/` / `.fleet/` / `.zed/` | ✅ | — | — | IDE directories (proactive; not currently in repo) |

### Quick sync check

```bash
# Entries in .rgignore but not in .gitignore (often intentional for tracked/generated files)
comm -23 <(grep -v '^#' .rgignore | grep -v '^$' | sort) <(grep -v '^#' .gitignore | grep -v '^$' | sort)

# Entries in .gitignore but missing from .rgignore (usually should be added)
comm -13 <(grep -v '^#' .rgignore | grep -v '^$' | sort) <(grep -v '^#' .gitignore | grep -v '^$' | sort)
```

> Note: This is a literal line diff. Root-relative patterns (`/foo/`) will show as
> different from unanchored ones (`foo/`), which is usually intentional. Use the
> `rg --files` validation commands below to confirm behavior rather than relying
> solely on string equality.

## Safe terminal aliases

To avoid symlink traversal and respect the global ignore file outside the repo:

```bash
alias rg="rg --no-follow --ignore-file ~/.rgignore"
```

## Editor notes

- VS Code: set `"search.useIgnoreFiles": true` so `.rgignore` is respected.
- Cursor: inherits VS Code settings; same flag applies.
- Most LSP / AI indexing extensions honor `.rgignore` when they shell out to `rg`.

## Validation

### Manual checks

```bash
# Files rg would index (respects .gitignore + .rgignore + ~/.rgignore)
rg --files | wc -l

# Files if we ignored nothing (should be much larger; proves ignores are working)
rg --files --no-ignore | wc -l

# Confirm no system/app paths leaked in
rg --files | rg -i '/Applications/' && echo "LEAK" || echo "clean"

# Confirm tracked source directories that share ignore names are still indexed
rg --files | rg '^(src|test|examples)(/[^/]+)*/(memory|var|guardian|governor|reports|profiles|tools)/' | sort
```

### Automated lint

The repo includes a discovery hygiene lint script at `scripts/lint-discovery.ts`
that verifies:

- No ignored path (system caches, build artifacts) leaks into `rg --files`
- No tracked source file under `src/`, `test/`, `bench/`, `examples/`, `scripts/`,
  or `docs/` is accidentally hidden by a broad ignore pattern

```bash
bun run scripts/lint-discovery.ts
```

## Adding new ignores

1. **Generated inside the repo** → `.rgignore`
2. **System/user-wide cache** → `~/.rgignore`
3. **Formatter-only noise** → `.oxfmtrc.json` `ignorePatterns`
4. **Should not be committed** → `.gitignore`

When adding a new directory ignore to `.rgignore`, ask:

- Is the directory only generated at the repo root? If yes, use a leading slash
  (`/dirname/`) so nested source directories with the same name remain searchable.
- Is it a generic name that might also be a tracked package or module? If yes,
  root-relative is almost always the safer choice.

### Sync checklist

When adding or modifying an ignore entry, update all relevant files in one pass:

1. **`.rgignore`** — add the pattern so `rg` / Grep tool / AI search skip it
2. **`.gitignore`** — add the pattern if the path should not be committed
3. **`.oxfmtrc.json`** `ignorePatterns` — add the pattern if the formatter would
   waste time walking the directory
4. **`docs/rgignore.md`** — update the embedded snippet and cross-file sync table
5. **Run validation** — `bun run scripts/lint-discovery.ts` and the manual checks
   above to confirm no leaks and no hidden tracked source
