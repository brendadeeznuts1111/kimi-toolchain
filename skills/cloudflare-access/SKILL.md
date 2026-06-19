---
name: cloudflare-access
description: |
  Cloudflare Access / Zero Trust hygiene — service token expiry, local inventory,
  policy audit, and policy-as-code. Use when Access tokens, app policies, or
  `.cloudflare-access.yml` drift need inspection or controlled apply.
whenToUse: |
  Access token expiry, app policy gaps, `.cloudflare-access.yml` drift, or
  `kimi-cloudflare-access doctor` / plan-before-apply workflows.
layer: L2
trigger:
  - Cloudflare Access token or policy audit
  - kimi-cloudflare-access doctor or fix
  - policy-as-code plan/apply
dependencies:
  - kimi-toolchain
loaded_by: On-demand / cloudflare-access topic
role: Zero Trust hygiene runbook — CLI surface, auth separation, plan-before-apply
token_estimate: 680
allowed_tools:
  - read_file
  - write_file
  - search_content
  - run_command
  - web_fetch
run_as: subagent
model: deepseek-v4-flash
---

# Cloudflare Access — Zero Trust Hygiene Skill

Audits Cloudflare Access / Zero Trust configurations: service token expiry, application policy gaps, and policy-as-code drift detection.

Exemplars: [CODE_REFERENCES.md](~/.kimi-code/CODE_REFERENCES.md) § Cloudflare Access.

## Architecture

This skill wraps the `kimi-cloudflare-access` CLI. Core logic:

- `src/lib/cloudflare-access.ts` — API client, token checks, credential management
- `src/lib/cloudflare-access-policy.ts` — Policy-as-Code diff engine
- `src/bin/kimi-cloudflare-access.ts` — CLI entry point

## CLI surface

```bash
kimi-cloudflare-access status
kimi-cloudflare-access dashboard
kimi-cloudflare-access tokens
kimi-cloudflare-access apps
kimi-cloudflare-access doctor
kimi-cloudflare-access fix
kimi-cloudflare-access plan
kimi-cloudflare-access apply
kimi-cloudflare-access mcp-apply
kimi-cloudflare-access login
kimi-cloudflare-access logout
```

Run `plan` before every `apply`. Show the planned app/policy diff and get explicit user confirmation before `apply`.

## Auth

1. `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` env vars (CI override)
2. OS keychain via `Bun.secrets` (`kimi-cloudflare-access login`)

Cloudflare MCP SSO/OAuth and Wrangler OAuth are separate from this CLI's API token path. A successful MCP or Wrangler login does not satisfy `kimi-cloudflare-access` unless account id and API token are also available.

## Recipes

### Token expiry sweep

```bash
kimi-cloudflare-access status
kimi-cloudflare-access tokens
kimi-cloudflare-access doctor
```

### Policy drift plan/apply

```bash
kimi-cloudflare-access apps
kimi-cloudflare-access plan
# user confirms diff
kimi-cloudflare-access apply
```

### Dashboard + MCP policy sync

```bash
kimi-cloudflare-access dashboard
kimi-cloudflare-access mcp-apply
```

### Credential reset

```bash
kimi-cloudflare-access logout
kimi-cloudflare-access login
kimi-cloudflare-access fix
```
