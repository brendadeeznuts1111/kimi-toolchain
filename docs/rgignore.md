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
/memory/
/var/
/guardian/
/governor/
/.bun-create/
/.cursor/
/.codex/
/.reasonix/
/.ast-grep/
/.tmp/
/.tmp-*/
/.tmp-kimi-test-home/

# SQLite databases
*.sqlite
*.sqlite-wal
*.sqlite-shm

# Compiled binaries
*.executable
cli
out.js
*.tar.gz
*.zip
*.wasm
*.node

# Compile-smoke temp
*.tmp-compile-smoke.ts
test-define-tmp.ts

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
`/guardian/`, `/governor/`, `/reports/`, `/profiles/`, etc.). A leading slash
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

```bash
# Files rg would index (respects .gitignore + .rgignore + ~/.rgignore)
rg --files | wc -l

# Files if we ignored nothing (should be much larger; proves ignores are working)
rg --files --no-ignore | wc -l

# Confirm no system/app paths leaked in
rg --files | rg -i '/Applications/' && echo "LEAK" || echo "clean"

# Confirm tracked source directories that share ignore names are still indexed
rg --files | rg '^(src|test|examples)(/[^/]+)*/(memory|var|guardian|governor|reports|profiles)/' | sort
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
