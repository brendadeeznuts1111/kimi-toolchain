---
title: "Documentation Style Guide"
tags: [docs, style-guide, conventions, markdown]
category: "meta"
priority: medium
---

<!-- status: stable; owner: @nolarose; review-date: 2026-07-21 -->

# Documentation Style Guide

## Description

Conventions for writing and organizing `.md` files in kimi-toolchain. Following these patterns ensures docs are discoverable via `rg` (ripgrep), render cleanly in GitHub/Mardown viewers, and maintain a consistent structure across the project.

## Frontmatter

Every `.md` file starts with YAML frontmatter:

```yaml
---
title: "Document Title"
tags: [relevant, tags, here]
category: "core | examples | meta"
priority: high | medium | low
---
```

**Rg searches:**
- `rg -g '*.md' '^tags:'` — list all tagged docs
- `rg -g '*.md' 'category: core'` — find all core docs
- `rg -g '*.md' 'priority: high'` — find all high-priority docs

## Header Hierarchy

Use a predictable heading structure:

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

Add `#find:` anchors before key sections for precise navigation:

```markdown
<!-- #find:secrets-rotation -->
## Rotation Policy
```

**Rg searches:**
- `rg -g '*.md' '#find:secrets-rotation'` — jump to rotation section
- `rg -g '*.md' '#find:'` — list all anchors

## Filename Conventions

- Use **kebab-case**: `secrets-manager.md`, `scanner-pipeline-spec.md`
- Group related files in folders: `docs/`, `examples/`
- Scope `rg` searches: `rg -g 'docs/**/*.md'` or `rg -g 'examples/**/*.md'`

## Cross-References

Every `.md` file ends with a `## Related` section linking to related docs:

```markdown
## Related

- [MACROS.md](../MACROS.md) — Bun macros API reference
- [examples/bun-macros.md](examples/bun-macros.md) — Practical examples
```

**Rg searches:**
- `rg -g '*.md' '\[.*\]\(.*\.md\)'` — find all cross-references (useful for building doc graphs)

## Quick Navigation Script

Add this shell function for fast doc searching:

```bash
function rgdoc() { rg -g '*.md' "$@"; }
```

Usage:
- `rgdoc '^## Description'` — find all description sections
- `rgdoc 'tags: bun'` — find all Bun-tagged docs
- `rgdoc '#find:'` — list all searchable anchors

## Related

- [INDEX.md](../INDEX.md) — Documentation index
- [MACROS.md](../MACROS.md) — Bun macros API reference
- [docs/scanner-pipeline-spec.md](scanner-pipeline-spec.md) — Scanner pipeline spec
