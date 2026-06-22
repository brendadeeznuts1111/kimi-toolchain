---
title: "Documentation Index"
tags: [index, docs, navigation]
category: meta
status: stable
priority: high
last-reviewed: "2026-06-22"
---

# Documentation Index

## Description

Single source of truth for all documentation files in kimi-toolchain. Every doc should be linked from here. Use `rg` with the patterns described in [docs/style-guide.md](docs/style-guide.md) for fast navigation.

## Root Documentation

| File | Description | Tags |
|------|-------------|------|
| [AGENTS.md](AGENTS.md) | kimi-toolchain — Agent Guide | `root` |
| [CHANGELOG.md](CHANGELOG.md) | Changelog | `root` |
| [CODE_REFERENCES.md](CODE_REFERENCES.md) | Code References for Agents | `root` |
| [CONTEXT.md](CONTEXT.md) | CONTEXT — kimi-toolchain | `root` |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributing to kimi-toolchain | `root` |
| [DEEP-QUALITY.md](DEEP-QUALITY.md) | Deep Quality Floor — Effect Discipline | `root` |
| [INDEX.md](INDEX.md) | Documentation Index | `index`, `docs`, `navigation` |
| [MACROS.md](MACROS.md) | Bun Macros — Build-Time Code Execution | `macros`, `bun`, `build-time`, `zero-overhead`, `bundling` |
| [README.md](README.md) | kimi-toolchain | `root` |
| [TEMPLATES.md](TEMPLATES.md) | Project Templates | `root` |
| [UNIFIED.md](UNIFIED.md) | Unified naming, paths, and development | `root` |

## Core Documentation

| File | Description | Tags |
|------|-------------|------|
| [docs/agent-api.md](docs/agent-api.md) | Agent API | `core` |
| [docs/dx-table.md](docs/dx-table.md) | dx:table — TOML property tables | `core` |
| [docs/finish-work-close-loop.md](docs/finish-work-close-loop.md) | Finish-work close-loop architecture | `core` |
| [docs/flake-register.md](docs/flake-register.md) | Flake Register | `core` |
| [docs/handoff-rules.md](docs/handoff-rules.md) | Herdr Orchestrator — Handoff Rules | `core` |
| [docs/naming.md](docs/naming.md) | CLI naming notes | `core` |
| [docs/rgignore.md](docs/rgignore.md) | Search / AI Discovery Ignore Stack | `core` |
| [docs/scanner-pipeline-spec.md](docs/scanner-pipeline-spec.md) | Scanner Pipeline Specification | `scanner`, `security`, `cve`, `osv`, `bun-patch`, `bun-glob`, `semver` |
| [docs/SCOPE.md](docs/SCOPE.md) | Production validation — Herdr orchestration layer | `core` |
| [docs/style-guide.md](docs/style-guide.md) | Documentation Style Guide | `docs`, `style-guide`, `conventions`, `markdown` |
| [docs/table-endpoints.md](docs/table-endpoints.md) | endpoints | `core` |
| [docs/table-herdr-orchestrator-dashboard.md](docs/table-herdr-orchestrator-dashboard.md) | herdr.orchestrator.dashboard | `core`, `dashboard`, `herdr` |
| [docs/table-herdr-orchestrator-remote_hosts.md](docs/table-herdr-orchestrator-remote_hosts.md) | herdr.orchestrator.remote_hosts | `core`, `herdr` |

## ADRs (Architecture Decision Records)

| File | Description | Tags |
|------|-------------|------|
| [docs/adr/ADR-0001-effect-gates-baseline.md](docs/adr/ADR-0001-effect-gates-baseline.md) | ADR 0001 — Effect Gates Baseline Register | `adr`, `effect`, `gates` |
| [docs/adr/ADR-0004-serve-probe-readonly.md](docs/adr/ADR-0004-serve-probe-readonly.md) | ADR 0004 — serve-probe Artifact API Is Read-Only | `adr` |

## References

| File | Description | Tags |
|------|-------------|------|
| [docs/references/bun-file-streaming.md](docs/references/bun-file-streaming.md) | Bun File Streaming Reference | `references`, `reference`, `bun` |
| [docs/references/bun-runtime-scaffold.md](docs/references/bun-runtime-scaffold.md) | Bun Runtime Scaffold Reference | `references`, `reference`, `bun` |
| [docs/references/bun-shell-companions.md](docs/references/bun-shell-companions.md) | Bun Shell Companion Reference | `references`, `reference`, `bun` |
| [docs/references/canonical-references-system.md](docs/references/canonical-references-system.md) | Canonical references system | `references`, `reference` |
| [docs/references/configuration-layers.md](docs/references/configuration-layers.md) | Configuration & Reference Layers: Discovery, Build, Parity, and Scaffold | `references`, `reference` |
| [docs/references/dashboard-thumbnails.md](docs/references/dashboard-thumbnails.md) | Dashboard thumbnails and WebView profile | `references`, `reference`, `dashboard` |
| [docs/references/herdr-plugin-architecture.md](docs/references/herdr-plugin-architecture.md) | Herdr unified plugin architecture (v0.5.0) | `references`, `reference`, `herdr` |
| [docs/references/herdr-socket-saturation-protocol.md](docs/references/herdr-socket-saturation-protocol.md) | Herdr Socket Saturation Protocol | `references`, `reference`, `herdr` |
| [docs/references/kimi-doctor.md](docs/references/kimi-doctor.md) | kimi-doctor dashboard-automation gate | `references`, `reference` |
| [docs/references/namespace.md](docs/references/namespace.md) | Namespace boundary — toolchain vs Herdr plugins | `references`, `reference` |
| [docs/references/serve-probe.md](docs/references/serve-probe.md) | kimi-doctor serve-probe — card cache + artifact inspection | `references`, `reference` |
| [docs/references/shell-spawn-choice.md](docs/references/shell-spawn-choice.md) | Shell Spawn Choice Reference | `references`, `reference` |
| [docs/references/template-matrix.md](docs/references/template-matrix.md) | Template Families Matrix | `references`, `reference` |
| [docs/references/testing-execution.md](docs/references/testing-execution.md) | Test execution model | `references`, `reference` |
| [docs/references/v53-architecture.md](docs/references/v53-architecture.md) | v5.3 Architecture — Consolidated Reference | `references`, `reference` |

## Plans (Archived)

| File | Description | Tags |
|------|-------------|------|
| [docs/plans/archive/dx-cloudflare-integration-plan.md](docs/plans/archive/dx-cloudflare-integration-plan.md) | DX Cloudflare Integration Plan | `plans` |
| [docs/plans/archive/dx-homepage-dashboard-plan.md](docs/plans/archive/dx-homepage-dashboard-plan.md) | DX Homepage Dashboard Product Plan | `plans`, `dashboard` |
| [docs/plans/archive/phase-5-config-lifecycle-plan.md](docs/plans/archive/phase-5-config-lifecycle-plan.md) | Phase 5 Config Lifecycle Plan | `plans` |

## Canvases

| File | Description | Tags |
|------|-------------|------|
| [docs/canvases/README.md](docs/canvases/README.md) | Canvas companions (kimi-toolchain) | `canvases` |

## Sub-tables

| File | Description | Tags |
|------|-------------|------|
| [docs/describe/table-endpoints.md](docs/describe/table-endpoints.md) | endpoints | `sub-tables` |
| [docs/groups/table-endpoints-github.com.md](docs/groups/table-endpoints-github.com.md) | endpoints (url_hostname=github.com) | `sub-tables` |
| [docs/groups/table-endpoints-mcp.cloudflare.com.md](docs/groups/table-endpoints-mcp.cloudflare.com.md) | endpoints (url_hostname=mcp.cloudflare.com) | `sub-tables` |

## Examples

| File | Description | Tags |
|------|-------------|------|
| [examples/artifact-dependency-graphs.md](examples/artifact-dependency-graphs.md) | Artifact Dependency Graphs | `examples`, `artifacts` |
| [examples/artifact-portal.md](examples/artifact-portal.md) | Artifact Portal — Canvas → Probe → Herdr → Artifact | `examples`, `portal`, `artifacts` |
| [examples/artifact-trading-loop.md](examples/artifact-trading-loop.md) | Artifact Feedback Loop — Trading Domain Example | `examples`, `artifacts` |
| [examples/bun-macros.md](examples/bun-macros.md) | Bun Macros — Practical Examples | `macros`, `bun`, `build-time`, `examples`, `color`, `fetch`, `htmlrewriter`, `base64` |
| [examples/control-plane-layers.md](examples/control-plane-layers.md) | Control Plane Layers — Artifact Architecture | `examples` |
| [examples/dashboard-urls.md](examples/dashboard-urls.md) | Examples Dashboard — URLs, Ports, Protocols & Properties | `examples`, `dashboard` |
| [examples/dashboard/README.md](examples/dashboard/README.md) | kimi-toolchain Dashboard | `examples` |
| [examples/dashboard/v53/README.md](examples/dashboard/v53/README.md) | kimi-toolchain v5.3 — Consolidated Profile | `examples` |
| [examples/dependency-graphs-developer-workflow.md](examples/dependency-graphs-developer-workflow.md) | Dependency Graphs — Developer Workflow | `examples` |
| [examples/gates/docs/dev.md](examples/gates/docs/dev.md) | Development Guide — Generic Gate Tree | `examples` |
| [examples/gates/docs/extend.md](examples/gates/docs/extend.md) | Generic Gate Tree Example — Extending the Gate Tree | `examples` |
| [examples/gates/README.md](examples/gates/README.md) | Generic Gate Tree Example | `examples` |
| [examples/guardian-failure.md](examples/guardian-failure.md) | Example: Dependency Change Blocked | `examples` |
| [examples/image-effect.md](examples/image-effect.md) | Image Effect — First Concrete Domain Effect | `examples`, `effect` |
| [examples/platform-absorption.md](examples/platform-absorption.md) | Platform Absorption — How Kimi Absorbs Bun Improvements | `examples` |
| [examples/portal/README.md](examples/portal/README.md) | Artifact Portal Example | `examples` |
| [examples/project-health-check.md](examples/project-health-check.md) | Example: Project Health Check | `examples` |
| [examples/README.md](examples/README.md) | kimi-toolchain Examples Showcase | `examples` |
| [examples/secrets-and-identity.md](examples/secrets-and-identity.md) | Secrets & Identity — Usage Examples | `secrets`, `identity`, `jwt`, `csrf`, `session`, `scanner`, `security` |
| [examples/trading-workspace/README.md](examples/trading-workspace/README.md) | Trading Artifact Loop | `examples` |
| [examples/what-broke.md](examples/what-broke.md) | Example: "What Broke?" | `examples` |

## Skills

| File | Description | Tags |
|------|-------------|------|
| [skills/cloudflare-access/SKILL.md](skills/cloudflare-access/SKILL.md) | Cloudflare Access — Zero Trust Hygiene Skill | `skills` |
| [skills/create-template/SKILL.md](skills/create-template/SKILL.md) | Create Template (L2) | `skills` |
| [skills/effect-discipline/references/README.md](skills/effect-discipline/references/README.md) | References (pointers only) | `skills` |
| [skills/effect-discipline/SKILL.md](skills/effect-discipline/SKILL.md) | Effect Discipline (L1+L2) | `skills` |
| [skills/effect-hardening/SKILL.md](skills/effect-hardening/SKILL.md) | Effect Hardening (L3) | `skills` |
| [skills/finish-work/SKILL.md](skills/finish-work/SKILL.md) | Finish-Work (L3) | `skills` |
| [skills/herdr/SKILL.md](skills/herdr/SKILL.md) | Herdr (L1+L2) | `skills` |
| [skills/kimi-toolchain/SKILL.md](skills/kimi-toolchain/SKILL.md) | Kimi-Toolchain (L1) | `skills` |
| [skills/orchestrator/SKILL.md](skills/orchestrator/SKILL.md) | Orchestrator (L3) | `skills` |

## Templates

| File | Description | Tags |
|------|-------------|------|
| [templates/bun-create/artifact-portal-convergence/README.md](templates/bun-create/artifact-portal-convergence/README.md) | {{name}} | `templates` |
| [templates/bun-create/kimi-dashboard/docs/extend.md](templates/bun-create/kimi-dashboard/docs/extend.md) | {{name}} — Extending the Dashboard | `templates` |
| [templates/bun-create/kimi-dashboard/README.md](templates/bun-create/kimi-dashboard/README.md) | {{name}} | `templates` |
| [templates/bun-create/kimi-gates/docs/extend.md](templates/bun-create/kimi-gates/docs/extend.md) | {{name}} — Extending the Gate Tree | `templates` |
| [templates/bun-create/kimi-gates/README.md](templates/bun-create/kimi-gates/README.md) | {{name}} | `templates` |
| [templates/bun-create/README.md](templates/bun-create/README.md) | bun-create templates | `templates` |
| [templates/herdr-dashboard/README.md](templates/herdr-dashboard/README.md) | Herdr dashboard templates | `templates` |
| [templates/README.md](templates/README.md) | Templates | `templates` |
| [templates/scaffold/adr-template.md](templates/scaffold/adr-template.md) | {{TITLE}} | `templates` |
| [templates/scaffold/code-references.md](templates/scaffold/code-references.md) | Code References for Agents | `templates` |
| [templates/scaffold/README.md](templates/scaffold/README.md) | {{PROJECT_NAME}} | `templates` |
| [templates/scaffold/skill-template.md](templates/scaffold/skill-template.md) | {{SKILL_TITLE}} (L1) | `templates` |
| [templates/scaffold/skills-readme.md](templates/scaffold/skills-readme.md) | Project skills | `templates` |

## Schemas

| File | Description | Tags |
|------|-------------|------|
| [schemas/README.md](schemas/README.md) | Table output schemas (`dx:table --schema`) | `schemas` |

## Test

| File | Description | Tags |
|------|-------------|------|
| [test/testing.md](test/testing.md) | Testing Conventions — kimi-toolchain | `test` |

## Source

| File | Description | Tags |
|------|-------------|------|
| [src/lib/README.md](src/lib/README.md) | src/lib/ — Domain Guide | `src` |

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
bun scripts/check-docs.ts           # check all docs
bun scripts/check-docs.ts --fix     # auto-fix missing frontmatter/Related/tags
bun scripts/check-docs.ts --json    # machine-readable JSON for CI
```

## Related

- [docs/style-guide.md](docs/style-guide.md) — Documentation style guide and conventions
- [MACROS.md](MACROS.md) — Bun macros API reference
- [scripts/check-docs.ts](scripts/check-docs.ts) — Documentation quality check script
