---
title: "Documentation Index"
tags: [index, docs, navigation]
category: "meta"
priority: high
---

<!-- status: stable; owner: @nolarose; review-date: 2026-07-21 -->

# Documentation Index

## Description

A complete index of all documentation files in kimi-toolchain. Use `rg` with the patterns described in [docs/style-guide.md](docs/style-guide.md) for fast navigation.

## Core Documentation

| File | Description | Tags |
|------|-------------|------|
| [MACROS.md](MACROS.md) | Bun macros — build-time code execution, all 7 macro patterns | `macros`, `bun`, `build-time` |
| [docs/scanner-pipeline-spec.md](docs/scanner-pipeline-spec.md) | Scanner pipeline spec — CVE scanning, Bun.semver, Bun.patch, Bun.Glob | `scanner`, `security`, `cve` |
| [docs/style-guide.md](docs/style-guide.md) | Documentation conventions — frontmatter, headers, #find: anchors | `docs`, `style-guide` |
| [docs/SCOPE.md](docs/SCOPE.md) | Project scope and architecture overview | `scope`, `architecture` |
| [docs/agent-api.md](docs/agent-api.md) | Agent API reference | `agent`, `api` |
| [docs/dx-table.md](docs/dx-table.md) | Developer experience table | `dx`, `developer-experience` |
| [docs/handoff-rules.md](docs/handoff-rules.md) | Handoff rules for agent transitions | `handoff`, `agents` |
| [docs/finish-work-close-loop.md](docs/finish-work-close-loop.md) | Finish-work close-loop process | `workflow`, `finish-work` |
| [docs/flake-register.md](docs/flake-register.md) | Flake register for intermittent test failures | `testing`, `flakes` |
| [docs/naming.md](docs/naming.md) | Naming conventions | `naming`, `conventions` |
| [docs/rgignore.md](docs/rgignore.md) | Ripgrep ignore patterns | `rg`, `search` |
| [docs/table-endpoints.md](docs/table-endpoints.md) | Endpoint reference table | `api`, `endpoints` |

## Examples

| File | Description | Tags |
|------|-------------|------|
| [examples/bun-macros.md](examples/bun-macros.md) | Practical Bun macro usage — 7 patterns with code | `macros`, `examples`, `color`, `fetch` |
| [examples/secrets-and-identity.md](examples/secrets-and-identity.md) | Secrets, identity (JWT/CSRF/session), scanner usage | `secrets`, `identity`, `jwt`, `scanner` |
| [examples/README.md](examples/README.md) | Examples overview and guide | `examples` |
| [examples/artifact-portal.md](examples/artifact-portal.md) | Artifact portal demo | `artifacts`, `demo` |
| [examples/artifact-dependency-graphs.md](examples/artifact-dependency-graphs.md) | Artifact dependency graphs | `artifacts`, `graphs` |
| [examples/artifact-trading-loop.md](examples/artifact-trading-loop.md) | Artifact trading loop | `artifacts`, `trading` |
| [examples/control-plane-layers.md](examples/control-plane-layers.md) | Control plane layers | `control-plane` |
| [examples/dependency-graphs-developer-workflow.md](examples/dependency-graphs-developer-workflow.md) | Developer workflow dependency graphs | `graphs`, `workflow` |
| [examples/guardian-failure.md](examples/guardian-failure.md) | Guardian failure scenarios | `guardian`, `security` |
| [examples/image-effect.md](examples/image-effect.md) | Image effect example | `image`, `effect` |
| [examples/platform-absorption.md](examples/platform-absorption.md) | Platform absorption patterns | `platform` |
| [examples/project-health-check.md](examples/project-health-check.md) | Project health check example | `health`, `diagnostics` |
| [examples/what-broke.md](examples/what-broke.md) | What broke — failure analysis | `debugging` |
| [examples/dashboard-urls.md](examples/dashboard-urls.md) | Dashboard URL reference | `dashboard`, `urls` |

## Quick Navigation

```bash
# Find all docs by tag
rgdoc 'tags: security'

# Find all description sections
rgdoc '^## Description'

# Find all #find: anchors
rgdoc '#find:'

# Find all cross-references
rgdoc '\[.*\]\(.*\.md\)'

# Find all stable docs
rgdoc 'status: stable'

# Find all high-priority docs
rgdoc 'priority: high'
```

## Related

- [docs/style-guide.md](docs/style-guide.md) — Documentation style guide and conventions
- [MACROS.md](MACROS.md) — Bun macros API reference
