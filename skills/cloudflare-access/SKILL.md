---
name: cloudflare-access
description: Cloudflare Access / Zero Trust hygiene — service token expiry, local inventory, policy audit, policy-as-code
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

## Architecture

This skill wraps the `kimi-cloudflare-access` CLI. The core logic lives in:

```
src/lib/cloudflare-access.ts              — API client, token checks, credential management
src/lib/cloudflare-access-policy.ts       — Policy-as-Code diff engine
src/lib/cloudflare-integration-status.ts  — Read-only local inventory (status/dashboard)
src/bin/kimi-cloudflare-access.ts         — CLI entry point
```

## Usage

```bash
# Read-only local inventory (credentials, MCP, wrangler, project files)
kimi-cloudflare-access status

# DX homepage/dashboard snapshot
kimi-cloudflare-access dashboard

# Audit service tokens for expiry (default when no subcommand)
kimi-cloudflare-access tokens

# Audit application policies
kimi-cloudflare-access apps

# Full doctor check
kimi-cloudflare-access doctor

# Rotate expired/expiring service tokens
kimi-cloudflare-access fix

# Policy-as-Code plan (dry-run)
kimi-cloudflare-access plan

# Policy-as-Code apply (mutates Access apps/policies)
kimi-cloudflare-access apply

# Emit MCP script for policy updates (no direct API apply)
kimi-cloudflare-access mcp-apply
```

Run `plan` before every `apply`. Agents must show the planned app/policy diff and get explicit user confirmation before running `apply`.

## Auth

1. `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` env vars (CI override)
2. OS keychain via `Bun.secrets` (set with `kimi-cloudflare-access login`)

Remove stored credentials with `kimi-cloudflare-access logout`.

Cloudflare MCP SSO/OAuth, Wrangler OAuth, and this CLI's API token path are separate. A successful MCP or Wrangler login does not satisfy `kimi-cloudflare-access` unless the account id and API token are also available. See `~/.kimi-code/UNIFIED.md` for the auth-path matrix.

Create an API token at https://dash.cloudflare.com/profile/api-tokens with:

- Account → Cloudflare Access → Read
- Account → Access: Service Tokens → Read

## Related

- `~/.kimi-code/UNIFIED.md` — Kimi Code vs kimi-toolchain map; Cloudflare auth separation
- `skills/kimi-toolchain/SKILL.md` — toolchain decision protocol
- `CODE_REFERENCES.md` — Cloudflare Access exemplars and tests
