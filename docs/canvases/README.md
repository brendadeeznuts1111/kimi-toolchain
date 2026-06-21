# Canvas companions (kimi-toolchain)

**SSOT:** `docs/canvases/*.canvas.tsx` — registered via `cursorCanvas` in
`canonical-references.toml` (`LOCAL_DOC_REFERENCES` → `cursorCanvas`). Lint: `bun run scripts/lint-cursor-canvas.ts`
(step `cursor-canvas` in `bun run lint`).

## Locations

| Location                                        | Role                                          | Linted?                                      |
| ----------------------------------------------- | --------------------------------------------- | -------------------------------------------- |
| `docs/canvases/*.canvas.tsx`                    | Repo SSOT · commits · manifest `cursorCanvas` | Yes                                          |
| `~/.cursor/projects/<workspace-slug>/canvases/` | Cursor IDE sidebar pickup                     | No — sync via `bun run sync:cursor-canvases` |

Clicks within canvases use repo-relative paths (`docs/canvases/…`) so they open
the SSOT file in the workspace.

## Skill scope (global vs repo)

| Doc                                                | Scope                                                   |
| -------------------------------------------------- | ------------------------------------------------------- |
| `~/.cursor/skills-cursor/canvas/SKILL.md`          | Generic canvas file rules · managed-dir pickup · design |
| docs-canvas plugin skill                           | Doc-style layout outline (placeholder upstream)         |
| **This README** + `skills/kimi-toolchain/SKILL.md` | Manifest-backed companions · lint                       |

Global canvas skills are **not** updated from this repo. Repo conventions live here.

## Every manifest canvas

1. Topic body (cards, tables, DAG — topic-specific)
2. Self-contained — one `.canvas.tsx` per companion, no shared imports
3. Registered with a `cursorCanvas` pointer in `canonical-references.toml` (`[[localDocs]]`)
4. `CANVAS_ROUTING`, hub stats, and `TOOL_INVENTORY` in `kimi-toolchain.canvas.tsx` are **generated** — run
   `bun run canvas:generate` after manifest, bin, or test-gate changes (checked by
   `bun run scripts/lint-cursor-canvas.ts`; `references:generate --check` includes canvas freshness)

## Canonical 11

| Manifest id                 | Canvas file                                    |
| --------------------------- | ---------------------------------------------- |
| `unified`                   | `kimi-toolchain.canvas.tsx`                    |
| `templates`                 | `kimi-fix.canvas.tsx`                          |
| `namespace`                 | `namespace-boundaries.canvas.tsx`              |
| `configuration-layers`      | `configuration-layers.canvas.tsx`              |
| `code-references`           | `doc-links-and-see-ladder.canvas.tsx`          |
| `kimi-doctor`               | `herdr-dashboard-automation.canvas.tsx`        |
| `dashboard-thumbnails`      | `herdr-dashboard-thumbnails.canvas.tsx`        |
| `herdr-plugin-architecture` | `herdr-unified-plugin-architecture.canvas.tsx` |
| `deep-quality`              | `kimi-heal-doctor-scaffold.canvas.tsx`         |
| `v53-architecture`          | `dashboard-card-registry.canvas.tsx`           |
| `artifact-lineage`          | `artifact-lineage.canvas.tsx`                  |

Manifest id matches the indexed doc (`DEEP-QUALITY.md`). The canvas filename
uses the topic stem (`kimi-heal-doctor-scaffold`); dashboard `?canvas=` filters
accept either `deep-quality` or `kimi-heal-doctor-scaffold`.
