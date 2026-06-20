# Search / AI Discovery Ignore Stack

This repo uses a layered ripgrep ignore strategy so `rg`, the Grep tool, and editor
search stay focused on source files and never wander into caches, build artifacts,
or system directories.

## Layer 1 — Project `.rgignore`

**Path:** `.rgignore`  
**Scope:** repo root only  
**Purpose:** ignore artifacts _generated inside this repo_.

```ignore
.kimi-artifacts/
.kimi/
.tmp-*/
~/.bun/
.bun/install/cache/
coverage/
*.log
*.tar.gz
*.zip
*.wasm
*.node
```

These paths are not necessarily tracked by Git, but they can be present locally
after running tests, sync, or build steps. Keeping them out of `rg` results speeds
up AI-assisted discovery and avoids surfacing irrelevant matches.

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
```

## Adding new ignores

1. **Generated inside the repo** → `.rgignore`
2. **System/user-wide cache** → `~/.rgignore`
3. **Formatter-only noise** → `.oxfmtrc.json` `ignorePatterns`
4. **Should not be committed** → `.gitignore`
