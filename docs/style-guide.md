---
title: "Documentation Style Guide"
tags: [docs, style-guide, conventions, markdown]
category: meta
status: stable
priority: medium
owner: "@nolarose"
last-reviewed: "2026-06-21"   # YYYY-MM-DD
---

# Documentation Style Guide

## Description

Conventions for writing and organizing `.md` files in kimi-toolchain. Following these patterns ensures docs are discoverable via `rg` (ripgrep), render cleanly in GitHub/Mardown viewers, and maintain a consistent structure across the project.

## Frontmatter

Every `.md` file starts with YAML frontmatter. **Recommended fields:** `title`, `tags`, `category`, `status`, `priority`. **Optional:** `owner`, `last-reviewed`.

```yaml
---
title: "Secrets Manager"
tags: [secrets, security, core]
category: core
status: stable          # draft | stable | deprecated
priority: high
owner: "@nolarose"
last-reviewed: "2026-06-21"   # YYYY-MM-DD  
---
```

**Field values:**
- `category`: `core` | `examples` | `meta`
- `status`: `draft` | `stable` | `deprecated`
- `priority`: `high` | `medium` | `low`

**Rg searches:**
- `rg -g '*.md' '^tags:'` — list all tagged docs
- `rg -g '*.md' 'category: core'` — find all core docs
- `rg -g '*.md' 'priority: high'` — find all high-priority docs
- `rg -g '*.md' 'status: deprecated'` — find docs needing migration

## Header Hierarchy

Predictable headings make docs scannable and `rg`-discoverable. Use this structure:

```markdown
# <Title>                   (H1 — the main subject, matches frontmatter title)

## Description              (H2 — what it does, 1-2 sentences)
## Installation / Setup     (H2 — how to get started)
## Usage                    (H2 — basic usage)
## API / Commands           (H2 — detailed reference)
### `command --flag`        (H3 — individual commands/options)
## Configuration            (H2 — config options)
## Examples                 (H2 — practical examples)
## Troubleshooting          (H2 — common issues)
## Related                  (H2 — links to other docs)
```

**Rg searches:**
- `rg -g '*.md' '^## Description'` — find all file descriptions
- `rg -g '*.md' '^## API'` — locate API reference sections
- `rg -g '*.md' '^## Related'` — find all cross-references

## Hidden Metadata Comments

Place machine-readable metadata in HTML comments (invisible in rendered output):

```markdown
<!-- status: stable; owner: @nolarose; review-date: 2026-07-21 -->
```

**Rg searches:**
- `rg -g '*.md' 'status:'` — list all docs by status
- `rg -g '*.md' 'owner:'` — find docs by owner

## `#find:` Anchors

`#find:` anchors let you jump directly to a section from any directory. Add them before key sections:

```markdown
<!-- #find:secrets-rotation -->
## Rotation Policy
```

**Rg searches:**
- `rg -g '*.md' '#find:secrets-rotation'` — jump to rotation section
- `rg -g '*.md' '#find:'` — list all anchors

## `#scan:` Markers

Use `#scan:` markers to flag complex code blocks, diagrams, or sections that benefit from targeted `rg` discovery. Place the comment immediately before the block:

    <!-- #scan:mermaid-diagram -->
    ```mermaid
    graph TD
      A --> B
    ```

**Rg searches:**
- `rg -g '*.md' '#scan:'` — list all marked blocks
- `rg -g '*.md' '#scan:mermaid'` — find all Mermaid diagrams

## Filename Conventions

- Use **kebab-case**: `secrets-manager.md`, `scanner-pipeline-spec.md`
- Group related files in folders: `docs/`, `examples/`
- Scope `rg` searches: `rg -g 'docs/**/*.md'` or `rg -g 'examples/**/*.md'`

## Document Structure

Most documents should follow this rough section order:

1. `## Description`
2. `## Usage` / `## Installation`
3. `## API` / `## Commands`
4. `## Examples`
5. `## Configuration`
6. `## Troubleshooting`
7. `## Related` (always last)

Not every document needs every section. Use judgment, but try to keep the general order consistent.

## Cross-References

Every documentation file **must** end with a `## Related` section (even if it only links back to `INDEX.md`). This prevents orphan documents and aids discoverability.

Use **relative links** (not absolute) so docs work across forks and mirrors:

```markdown
## Related

- [MACROS.md](../MACROS.md) — Bun macros API reference
- [examples/bun-macros.md](examples/bun-macros.md) — Practical examples
```

**Rg searches:**
- `rg -g '*.md' '\[.*\]\(.*\.md\)'` — find all cross-references (useful for building doc graphs)

## Linking Style

- Use **relative paths** for internal links: `[style guide](docs/style-guide.md)`
- Use **absolute URLs** only for external resources: `[Bun docs](https://bun.sh/docs)`
- Keep link text descriptive — avoid "click here"

## Do / Don't

| Do | Don't |
|-----|-------|
| Use kebab-case filenames | Use spaces or CamelCase in filenames |
| Add `#find:` anchors to key sections | Rely solely on header text for navigation |
| End every doc with `## Related` | Leave docs without cross-references |
| Keep frontmatter fields consistent | Omit `tags` or `category` |
| Use relative links for internal refs | Hardcode absolute paths to repo files |
| Use descriptive link text | Use "click here" or bare URLs as link text |  

## INDEX.md

`INDEX.md` is the single source of truth for documentation structure. Every doc should be linked from it, and it should be updated whenever docs are added or removed.

## Quick Navigation Script

Add these shell functions and aliases for fast doc searching:

```bash
# Search only .md files
alias rgmd='rg -g "*.md"'

# Same, as a function (useful in scripts)
function rgdoc() { rg -g '*.md' "$@"; }
```

Usage:
- `rgdoc '^## Description'` — find all description sections
- `rgdoc 'tags: bun'` — find all Bun-tagged docs
- `rgdoc '#find:'` — list all searchable anchors
- `rgmd 'tags: security'` — find all security-tagged docs
- `rgmd '#find:secrets-rotation' -A 5` — jump to a section with context
- `rgmd '#scan:'` — list all marked code blocks/diagrams

## Quality Checks

Run `scripts/check-docs.ts` to verify all `.md` files follow these conventions:

```bash
bun scripts/check-docs.ts           # check entire repo (default)
bun scripts/check-docs.ts docs/     # check a specific directory
bun scripts/check-docs.ts --fix     # auto-add missing frontmatter + ## Related
bun scripts/check-docs.ts --json    # machine-readable JSON for CI/dashboards
```

The script uses `Bun.color()` with hex values (aligned with `src/lib/cli-format.ts`) and `Bun.inspect.table` for clean tabular output. Colors are suppressed when stdout is not a TTY. Add it to pre-commit hooks or CI to keep docs healthy.

## Keeping This Guide Current

This style guide should be reviewed when:
- New documentation patterns are adopted
- `rg` search conventions change
- New frontmatter fields are introduced

Update `last-reviewed` in the frontmatter on each review.

## Related

- [INDEX.md](../INDEX.md) — Documentation index (source of truth)
- [MACROS.md](../MACROS.md) — Bun macros API reference
- [docs/scanner-pipeline-spec.md](scanner-pipeline-spec.md) — Scanner pipeline spec
