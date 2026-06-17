# DX Cloudflare Integration Plan

This plan covers the first bounded slice for making DX a Cloudflare-backed
control surface without mutating live Cloudflare state. The target is a typed,
read-only-first contract that can later drive a Cloudflare Access-protected
homepage, managed domain readiness checks, and MCP-assisted operations.

## Current Capabilities

- `dx context`, `dx config`, `dx mcp-status`, and `dx secrets status` already
  provide the global-first DX posture, MCP wiring state, and masked credential
  inventory.
- `kimi-cloudflare-access doctor` validates the API-token credential boundary
  for Cloudflare Access and keeps Wrangler OAuth and Cloudflare MCP OAuth
  separate.
- `kimi-cloudflare-access dashboard --json` can map Cloudflare Access
  applications to local projects, package metadata, Wrangler config,
  `.cloudflare-access.yml`, bindings, and policy risk.
- `kimi-cloudflare-access plan` and `apply --dry-run` already support
  policy-as-code against `.cloudflare-access.yml`; real `apply` remains
  explicit and guarded.
- `src/lib/mcp-config.ts` provisions the `cloudflare-api` remote MCP endpoint
  and validates user/project MCP overrides without removing unrelated servers.

## Missing Pieces

- A first-class DX Cloudflare contract in project/global config for dashboard
  hostname, managed domain, Access app policy, and MCP endpoint posture.
- A local snapshot format that joins DX status, Access app inventory, managed
  domain readiness, MCP readiness, secrets posture, and artifact posture.
- A hosted homepage package, preferably Cloudflare Workers or Pages behind
  Cloudflare Access, that reads generated snapshots instead of browser-visible
  secrets.
- Managed-domain checks for zone ownership, DNS records, Worker custom domain or
  route, TLS certificate status, and Access app visibility in the App Launcher.
- An MCP safety layer that distinguishes read-only discovery from proposed
  mutations and writes every proposed mutation to a reviewable plan artifact.
- Tests that prove all of the above can be evaluated without a Cloudflare API
  call by using fixture snapshots.

## Execution Teams

### Access and SSO Team

Owns Cloudflare Access app inventory, App Launcher visibility, IdP/MFA policy,
and credential posture.

First milestones:

1. Add a `dx.cloudflare` config contract with `accessAppName`, `teamDomain`,
   `allowedEmailDomains`, `requireMfa`, and `appLauncherVisible`.
2. Extend the existing Access dashboard evaluator to report App Launcher
   readiness separately from policy risk.
3. Add fixtures for one healthy app, one hidden app, one app missing IdP
   restriction, and one app with a bypass policy.

### Managed Domain Team

Owns the DX homepage hostname and Cloudflare-managed domain readiness.

First milestones:

1. Add plan-only checks for `zoneName`, `hostname`, `workerName`, and
   `deploymentMode = "workers-custom-domain" | "pages-custom-domain"`.
2. Parse local `wrangler.toml`, `wrangler.json`, and `wrangler.jsonc` with a
   structured parser where possible, falling back to current text extraction
   only for legacy configs.
3. Emit a domain readiness report with DNS, custom domain, route, TLS, and Access
   attachment checks; keep every live Cloudflare mutation out of this phase.

### MCP Team

Owns Cloudflare MCP endpoint posture and mutation safety.

First milestones:

1. Promote the Cloudflare MCP endpoint list from docs into typed constants with
   tests for `cloudflare-api`, `cloudflare-docs`, `cloudflare-bindings`,
   `cloudflare-builds`, and `cloudflare-observability`.
2. Add validation that reports whether Cloudflare MCP is configured,
   authenticated by the client, and scoped for read-only discovery or mutation.
3. Replace generated copy/paste mutation scripts with a plan artifact that can
   be reviewed before any MCP execution path is enabled.

### Dashboard Homepage Team

Owns the user-facing DX homepage and local/hosted snapshot flow.

First milestones:

1. Define a `dx-cloudflare-snapshot.json` schema with sections for DX, Access,
   domain, MCP, artifacts, secrets, and project mappings.
2. Add a read-only `dx cloudflare home --json` equivalent in this repo first,
   likely as a new `kimi-cloudflare-access home --json` command or shared
   library function.
3. Build the hosted homepage only after the snapshot contract is stable. The
   first version should be a static Worker or Pages app protected by Cloudflare
   Access and fed by explicit snapshot publish steps.

### Integrator Team

Owns gates, docs, and release posture.

First milestones:

1. Add unit coverage for snapshot evaluation and config parsing.
2. Add a smoke path that proves the homepage snapshot can be generated with no
   Cloudflare credentials, marking live-only sections as blocked instead of
   failing the entire report.
3. Keep `bun run sync && bun run sync:verify` in final validation whenever
   synced runtime docs, templates, skills, or tools change.

## First PR Slice

The first implementation PR should stay local and read-only:

1. Introduce `src/lib/dx-cloudflare-home.ts` with typed config and fixture-driven
   snapshot evaluation.
2. Add `test/dx-cloudflare-home.unit.test.ts` for healthy, missing credentials,
   hidden App Launcher, missing managed domain, and MCP-not-configured cases.
3. Add a CLI command that prints the snapshot JSON without contacting Cloudflare
   unless credentials are present and the user explicitly asks for live refresh.
4. Document the hosted homepage deployment as a later phase; do not add Wrangler
   deploy automation until the snapshot contract is tested.

## Validation Commands

Run these before proposing any Cloudflare-backed deploy work:

```sh
dx context
dx config --project .
dx mcp-status
dx secrets status
bun run src/bin/kimi-cloudflare-access.ts doctor --json
bun test test/cloudflare-access-dashboard.unit.test.ts test/mcp-config.unit.test.ts
bun run check:fast
```

When runtime-synced files change:

```sh
bun run sync && bun run sync:verify
```
