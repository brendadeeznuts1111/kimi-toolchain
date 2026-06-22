---
title: "Documentation Index"
tags: [index, docs, navigation]
category: meta
status: stable
priority: high
owner: "@nolarose"
last-reviewed: "2026-06-21"   # YYYY-MM-DD
---

# Documentation Index

## Description

Single source of truth for all documentation files in kimi-toolchain. Every doc should be linked from here. Use `rg` with the patterns described in [docs/style-guide.md](docs/style-guide.md) for fast navigation.

## Root Documentation

| File | Description | Tags |
|------|-------------|------|
| [README.md](README.md) | Project overview, install, commands, project structure | `root`, `install`, `commands` |
| [AGENTS.md](AGENTS.md) | Agent configuration and capabilities | `agents`, `config` |
| [CHANGELOG.md](CHANGELOG.md) | Release history and changes | `changelog`, `releases` |
| [CODE_REFERENCES.md](CODE_REFERENCES.md) | Code reference index | `references`, `index` |
| [CONTEXT.md](CONTEXT.md) | Project context for agents | `context`, `agents` |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributing guidelines | `contributing`, `process` |
| [DEEP-QUALITY.md](DEEP-QUALITY.md) | Deep quality standards and practices | `quality`, `standards` |
| [MACROS.md](MACROS.md) | Bun macros — build-time code execution, all 7 macro patterns | `macros`, `bun`, `build-time` |
| [TEMPLATES.md](TEMPLATES.md) | Template reference and matrix | `templates`, `scaffolding` |
| [UNIFIED.md](UNIFIED.md) | How Kimi Code, kimi-toolchain, and ~/.kimi-code/ relate | `architecture`, `unified` |

## Core Documentation

| File | Description | Tags |
|------|-------------|------|
| [docs/style-guide.md](docs/style-guide.md) | Documentation conventions — frontmatter, headers, #find: anchors | `docs`, `style-guide` |
| [docs/scanner-pipeline-spec.md](docs/scanner-pipeline-spec.md) | Scanner pipeline spec — CVE scanning, Bun.semver, Bun.patch, Bun.Glob | `scanner`, `security`, `cve` |
| [docs/SCOPE.md](docs/SCOPE.md) | Project scope and architecture overview | `scope`, `architecture` |
| [docs/agent-api.md](docs/agent-api.md) | Agent API reference | `agent`, `api` |
| [docs/dx-table.md](docs/dx-table.md) | Developer experience table | `dx`, `developer-experience` |
| [docs/handoff-rules.md](docs/handoff-rules.md) | Handoff rules for agent transitions | `handoff`, `agents` |
| [docs/finish-work-close-loop.md](docs/finish-work-close-loop.md) | Finish-work close-loop process | `workflow`, `finish-work` |
| [docs/flake-register.md](docs/flake-register.md) | Flake register for intermittent test failures | `testing`, `flakes` |
| [docs/naming.md](docs/naming.md) | Naming conventions | `naming`, `conventions` |
| [docs/rgignore.md](docs/rgignore.md) | Ripgrep ignore patterns | `rg`, `search` |
| [docs/table-endpoints.md](docs/table-endpoints.md) | Endpoint reference table | `api`, `endpoints` |
| [docs/table-herdr-orchestrator-dashboard.md](docs/table-herdr-orchestrator-dashboard.md) | Herdr orchestrator dashboard endpoints | `herdr`, `dashboard`, `endpoints` |
| [docs/table-herdr-orchestrator-remote_hosts.md](docs/table-herdr-orchestrator-remote_hosts.md) | Herdr orchestrator remote hosts endpoints | `herdr`, `endpoints` |

## ADRs (Architecture Decision Records)

| File | Description | Tags |
|------|-------------|------|
| [docs/adr/ADR-0001-effect-gates-baseline.md](docs/adr/ADR-0001-effect-gates-baseline.md) | Effect gates baseline decision | `adr`, `effect`, `gates` |
| [docs/adr/ADR-0004-serve-probe-readonly.md](docs/adr/ADR-0004-serve-probe-readonly.md) | Serve-probe read-only decision | `adr`, `serve-probe` |

## References

| File | Description | Tags |
|------|-------------|------|
| [docs/references/bun-file-streaming.md](docs/references/bun-file-streaming.md) | Bun file streaming reference | `bun`, `streaming`, `reference` |
| [docs/references/bun-runtime-scaffold.md](docs/references/bun-runtime-scaffold.md) | Bun runtime scaffold reference | `bun`, `runtime`, `reference` |
| [docs/references/bun-shell-companions.md](docs/references/bun-shell-companions.md) | Bun shell companions reference | `bun`, `shell`, `reference` |
| [docs/references/canonical-references-system.md](docs/references/canonical-references-system.md) | Canonical references system | `references`, `canonical` |
| [docs/references/configuration-layers.md](docs/references/configuration-layers.md) | Configuration layers reference | `config`, `reference` |
| [docs/references/dashboard-thumbnails.md](docs/references/dashboard-thumbnails.md) | Dashboard thumbnails reference | `dashboard`, `reference` |
| [docs/references/herdr-plugin-architecture.md](docs/references/herdr-plugin-architecture.md) | Herdr plugin architecture | `herdr`, `plugin`, `reference` |
| [docs/references/herdr-socket-saturation-protocol.md](docs/references/herdr-socket-saturation-protocol.md) | Herdr socket saturation protocol | `herdr`, `socket`, `reference` |
| [docs/references/kimi-doctor.md](docs/references/kimi-doctor.md) | kimi-doctor reference | `kimi-doctor`, `reference` |
| [docs/references/namespace.md](docs/references/namespace.md) | Namespace reference | `namespace`, `reference` |
| [docs/references/serve-probe.md](docs/references/serve-probe.md) | Serve-probe reference | `serve-probe`, `reference` |
| [docs/references/shell-spawn-choice.md](docs/references/shell-spawn-choice.md) | Shell spawn choice reference | `shell`, `reference` |
| [docs/references/template-matrix.md](docs/references/template-matrix.md) | Template matrix reference | `templates`, `reference` |
| [docs/references/testing-execution.md](docs/references/testing-execution.md) | Testing execution reference | `testing`, `reference` |
| [docs/references/v53-architecture.md](docs/references/v53-architecture.md) | v53 architecture reference | `architecture`, `v53`, `reference` |

## Sub-tables

| File | Description | Tags |
|------|-------------|------|
| [docs/describe/table-endpoints.md](docs/describe/table-endpoints.md) | Endpoint description table | `api`, `endpoints`, `describe` |
| [docs/groups/table-endpoints-github.com.md](docs/groups/table-endpoints-github.com.md) | GitHub endpoint groups | `api`, `endpoints`, `github` |
| [docs/groups/table-endpoints-mcp.cloudflare.com.md](docs/groups/table-endpoints-mcp.cloudflare.com.md) | Cloudflare MCP endpoint groups | `api`, `endpoints`, `cloudflare` |

## Plans (Archived)

| File | Description | Tags |
|------|-------------|------|
| [docs/plans/archive/dx-cloudflare-integration-plan.md](docs/plans/archive/dx-cloudflare-integration-plan.md) | DX Cloudflare integration plan | `dx`, `cloudflare`, `plan` |
| [docs/plans/archive/dx-homepage-dashboard-plan.md](docs/plans/archive/dx-homepage-dashboard-plan.md) | DX homepage dashboard plan | `dx`, `dashboard`, `plan` |
| [docs/plans/archive/phase-5-config-lifecycle-plan.md](docs/plans/archive/phase-5-config-lifecycle-plan.md) | Phase 5 config lifecycle plan | `config`, `plan`, `archive` |

## Canvases

| File | Description | Tags |
|------|-------------|------|
| [docs/canvases/README.md](docs/canvases/README.md) | Canvases directory overview | `canvases` |

## Examples

| File | Description | Tags |
|------|-------------|------|
| [examples/README.md](examples/README.md) | Examples overview and guide | `examples` |
| [examples/bun-macros.md](examples/bun-macros.md) | Practical Bun macro usage — 7 patterns with code | `macros`, `examples`, `color`, `fetch` |
| [examples/secrets-and-identity.md](examples/secrets-and-identity.md) | Secrets, identity (JWT/CSRF/session), scanner usage | `secrets`, `identity`, `jwt`, `scanner` |
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

## Example Sub-directories

| File | Description | Tags |
|------|-------------|------|
| [examples/dashboard/README.md](examples/dashboard/README.md) | Dashboard examples overview | `dashboard`, `examples` |
| [examples/dashboard/v53/README.md](examples/dashboard/v53/README.md) | v53 dashboard examples | `dashboard`, `v53`, `examples` |
| [examples/gates/README.md](examples/gates/README.md) | Gates examples overview | `gates`, `examples` |
| [examples/gates/docs/dev.md](examples/gates/docs/dev.md) | Gates development docs | `gates`, `dev` |
| [examples/gates/docs/extend.md](examples/gates/docs/extend.md) | Gates extension docs | `gates`, `extend` |
| [examples/portal/README.md](examples/portal/README.md) | Portal examples overview | `portal`, `examples` |
| [examples/trading-workspace/README.md](examples/trading-workspace/README.md) | Trading workspace examples | `trading`, `workspace`, `examples` |

## Quick Navigation

```bash
# Find all docs by tag
rgdoc 'tags: security'

# Find all description sections
rgdoc '^## Description'

# Find all #find: anchors
rgdoc '#find:'

# Find all #scan: markers
rgdoc '#scan:'

# Find all cross-references
rgdoc '\[.*\]\(.*\.md\)'

# Find all stable docs
rgdoc 'status: stable'

# Find all high-priority docs
rgdoc 'priority: high'

# Run quality checks
bun scripts/check-docs.ts
```

## Related

- [docs/style-guide.md](docs/style-guide.md) — Documentation style guide and conventions
- [MACROS.md](MACROS.md) — Bun macros API reference
- [scripts/check-docs.ts](scripts/check-docs.ts) — Documentation quality check script
