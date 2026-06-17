# DX Homepage Dashboard Product Plan

Date: 2026-06-15
Owner: Product/UX Team
Scope: first bounded slice for the DX homepage/dashboard experience.

## Product Goal

Create a local-first DX homepage that lets agents and maintainers answer four questions quickly:

- Is this machine ready for DX work?
- Which projects are mapped to Cloudflare Access applications?
- Which Cloudflare SSO, domain, MCP, and runtime checks need attention?
- Which remediations are safe, which require explicit approval, and which are out of scope?

The first slice should reuse existing JSON-producing tools and avoid a hosted deployment surface until the data contract and safety model are stable.

## Current Grounding

- `dx.config.toml` defines global-first Bun defaults, bootstrap commands, quality gates, sync, and manual release/upload posture.
- `kimi-cloudflare-access dashboard --json` returns Access app mappings, local project discovery, policy risk counts, wrangler/access config presence, infrastructure hints, orphaned resources, and summary counts.
- `src/lib/mcp-config.ts` provisions and validates user MCP servers for `unified-shell` and `cloudflare-api`.
- `UNIFIED.md` documents that Cloudflare MCP SSO/OAuth, Wrangler OAuth, and `kimi-cloudflare-access` API tokens are separate auth paths.
- `test/cloudflare-access-dashboard.unit.test.ts` defines the current status model: `ok`, `warn`, `error`, and `info`.

Cloudflare platform docs support this direction:

- Cloudflare Access protects web applications as an identity-aware proxy and evaluates configured Access policies before allowing requests.
- Worker Custom Domains can attach a Worker to a domain/subdomain while Cloudflare manages DNS records and certificates.
- Cloudflare runs managed remote MCP servers that expose Cloudflare account/resource capabilities through OAuth-capable MCP clients.

## Team Execution Model

### Product/UX Team

Own homepage information architecture, card language, safety states, and acceptance criteria. This document is the first-slice UX contract.

### Contract/Data Team

Extract a stable dashboard snapshot contract from existing CLI outputs:

- `DxHomepageSnapshot`
- `DxReadinessCard`
- `CloudflareAccessCard`
- `ManagedDomainCard`
- `McpCard`
- `ActionRecommendation`

Keep this pure and testable. The first implementation should aggregate existing commands rather than introducing live Cloudflare reads in UI code.

### Cloudflare Team

Map Cloudflare Access, domain, Worker, and MCP state into the dashboard snapshot while preserving auth boundaries:

- Access API token status
- Wrangler OAuth status
- Cloudflare MCP OAuth/status
- Managed domain, zone, Worker route, or custom domain status

No mutation should occur from the homepage in the first slice.

### MCP/Safety Team

Define action classes and enforcement:

- `read_only`: safe diagnostics and status refresh
- `plan_only`: generates a diff or script but does not mutate
- `manual_apply`: requires explicit CLI confirmation or user-mediated MCP action
- `blocked`: missing credentials, invalid config, or unsafe policy

### Test/Docs Team

Add unit tests for the snapshot mapper and update README/UNIFIED only after the first implementation is present. Keep docs aligned with command output and scaffold defaults.

## Information Architecture

### 1. Header

Purpose: immediate orientation.

Content:

- Project name: `kimi-toolchain`
- DX mode from `dx.config.toml`
- Runtime: Bun version and package manager
- Current branch and repo state when available
- Last snapshot time
- Overall status: `Ready`, `Needs Attention`, or `Blocked`

Primary commands:

- `dx context`
- `dx config --project .`
- `kimi-doctor --agent-ready`
- `kimi-cloudflare-access dashboard --json`

### 2. Readiness Row

Cards:

- DX Defaults: global-first enabled, Bun version, bootstrap commands present
- Quality Gates: `check:fast`, full validation, sync verify
- Secrets: Cloudflare/R2/npm credential posture, redacted and count-only
- Runtime Sync: repo-to-`~/.kimi-code` sync status

Statuses:

- `ok`: configured and verified
- `warn`: drift or missing optional config
- `error`: required local contract invalid
- `info`: unavailable but non-blocking

### 3. Cloudflare SSO Projects

Purpose: make the existing terminal dashboard scannable.

Columns:

- Access application name
- Domain
- Local project path
- Policy status
- Bypass count
- Allow-everyone count
- IdP restriction status
- Wrangler config present
- `.cloudflare-access.yml` present
- Worker, route, R2, D1, KV hints
- Notes

Default sort:

1. `error`
2. `warn`
3. `info`
4. `ok`

Required filters:

- Status
- Mapped/unmapped
- Missing wrangler config
- Missing Access config
- Has bypass policy
- Has allow-everyone policy

### 4. Managed Domains

Purpose: show whether the intended homepage/domain setup is ready.

First-slice fields:

- Desired hostname
- Cloudflare zone/account presence
- Worker or Pages project binding intent
- Custom domain or route intent
- Access application linked or missing
- Certificate/DNS state if available from existing commands
- Recommended next command

Initial state can be `unknown` until a domain inventory command exists. The UI should still show the gap explicitly.

### 5. MCP

Purpose: make agent tool wiring visible without implying one auth flow covers all others.

Cards:

- `unified-shell`: local stdio server configured
- `cloudflare-api`: remote Cloudflare MCP server configured
- Optional Cloudflare MCP endpoints: docs, bindings, builds, observability
- Project override: `.kimi-code/mcp.json` absent/stub/custom
- Auth note: Cloudflare MCP OAuth is separate from Wrangler OAuth and Access API tokens

Actions:

- Read-only: show configured servers
- Plan-only: propose optional endpoint additions
- Manual apply: run `kimi-doctor --fix` or `/mcp-config` outside the homepage

### 6. Recommended Actions

Each action must have:

- Title
- Reason
- Source check
- Safety class
- Command
- Expected effect
- Blocking credentials/config

Examples:

- `Run dx mcp-status` (`read_only`)
- `Run kimi-cloudflare-access login` (`manual_apply`, local keychain write)
- `Run kimi-cloudflare-access plan` (`plan_only`)
- `Run bun run sync && bun run sync:verify` (`manual_apply`, runtime sync)
- `Add .cloudflare-access.yml to mapped project` (`manual_apply`, repo edit)

## Workflows

### Agent Starts Work

1. Opens homepage snapshot.
2. Checks header and readiness row.
3. Runs only read-only diagnostics if stale.
4. Uses recommended actions as explicit commands.

### Maintainer Reviews Cloudflare SSO

1. Opens Cloudflare SSO Projects.
2. Filters to `error` and `warn`.
3. Inspects bypass, allow-everyone, and IdP issues.
4. Runs `kimi-cloudflare-access plan` before any mutation.

### Maintainer Prepares Managed Domain

1. Opens Managed Domains.
2. Confirms desired hostname and account/zone status.
3. Reviews whether Worker custom domain or route is intended.
4. Uses a future domain plan command before any Cloudflare change.

### Agent Checks MCP

1. Opens MCP section.
2. Confirms `unified-shell` and `cloudflare-api`.
3. Notes optional Cloudflare MCP endpoints as recommendations only.
4. Does not edit `config.toml` for MCP servers.

## Safety States

| State             | Meaning                                               | Homepage behavior                                  |
| ----------------- | ----------------------------------------------------- | -------------------------------------------------- |
| `ready`           | Checks pass; no blocking work                         | Show normal status and optional actions            |
| `needs_attention` | Warnings or unmapped resources                        | Sort warnings first and show plan-only remediation |
| `blocked`         | Missing credentials, invalid config, or policy errors | Disable apply-style recommendations                |
| `unknown`         | Signal not implemented or unavailable                 | Show source gap and next read-only command         |

## First PR Scope

Build the non-hosted snapshot foundation and CLI preview before any Cloudflare deployment.

In scope:

- Add a pure dashboard snapshot mapper around existing report shapes.
- Add a CLI command or subcommand that prints the homepage snapshot as JSON.
- Add a compact terminal summary for humans.
- Add tests with fixture inputs covering fully ready state, missing Cloudflare credentials, bypass policy, missing wrangler config, missing `.cloudflare-access.yml`, MCP configured/missing/overridden, and managed domain unknown state.
- Add this report as the product contract for implementation.

Suggested command shape:

```bash
kimi-toolchain dashboard --json
kimi-toolchain dashboard
```

Fallback if the unified CLI is not ready:

```bash
kimi-cloudflare-access dashboard --homepage --json
```

## Non-Goals

- Hosted Cloudflare Worker or Pages app.
- Mutating Cloudflare Access policies from the homepage.
- Creating DNS records, Worker routes, or custom domains.
- Storing secrets in dashboard snapshots.
- Combining Cloudflare MCP OAuth, Wrangler OAuth, and Access API-token auth.
- Adding frontend dependencies.
- Replacing the existing terminal dashboard.

## Acceptance Criteria

- The first PR adds no new runtime dependency.
- The snapshot mapper is pure and unit-tested.
- UI/summary data comes from existing typed reports or narrow adapters.
- The public terminal Cloudflare dashboard behavior stays compatible.
- Secrets are never serialized into dashboard snapshots.
- Cloudflare auth paths remain visibly separate.
- Bypass policies are always `error`.
- Allow-everyone policies are at least `warn`.
- Missing local project remains `info` unless paired with a policy error.
- Missing `wrangler` config on a mapped project is `warn`.
- Missing `.cloudflare-access.yml` on a mapped project is visible but does not block read-only use.
- Managed domain status may be `unknown` in the first PR, but the card and contract exist.
- MCP project overrides warn when they shadow or disable expected user-level defaults.
- Validation includes the focused new tests plus `bun run check:fast`.

## Follow-On Slices

1. Hosted local dev UI using Bun only, consuming the snapshot JSON.
2. Cloudflare Worker or Pages homepage behind Access SSO.
3. Managed domain inventory and plan-only diff command.
4. MCP endpoint optional provisioning plan.
5. Dashboard action ledger using the existing decision ledger.
6. Cloudflare deploy workflow with explicit manual approval and sync verification.
