---
name: cloudflare-access
description: Cloudflare Access / Zero Trust hygiene — service token expiry sweep, policy audit, policy-as-code
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

This skill wraps the `kimi-cloudflare-access` CLI which was originally part of `kimi-toolchain`. The core logic lives in:

```
src/lib/cloudflare-access.ts         — API client, token checks, credential management
src/lib/cloudflare-access-policy.ts  — Policy-as-Code diff engine
src/bin/kimi-cloudflare-access.ts    — CLI entry point (doctor/fix/plan/apply)
```

## Usage

```bash
# Audit service tokens for expiry
kimi-cloudflare-access tokens

# Audit application policies
kimi-cloudflare-access apps

# Full doctor check
kimi-cloudflare-access doctor

# Policy-as-Code plan (dry-run)
kimi-cloudflare-access plan

# Policy-as-Code apply (mutates Access apps/policies)
kimi-cloudflare-access apply
```

Run `plan` before every `apply`. Agents must show the planned app/policy diff and get explicit user confirmation before running `apply`.

## Auth

1. `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` env vars (CI override)
2. OS keychain via `Bun.secrets` (set with `kimi-cloudflare-access login`)

Cloudflare MCP SSO/OAuth, Wrangler OAuth, and this CLI's API token path are separate. A successful MCP or Wrangler login does not satisfy `kimi-cloudflare-access` unless the account id and API token are also available.

Create an API token at https://dash.cloudflare.com/profile/api-tokens with:

- Account → Cloudflare Access → Read
- Account → Access: Service Tokens → Read

## Future

This skill is a candidate for extraction into a standalone package or optional kimi-toolchain plugin. The 2,473 lines of Cloudflare logic (15% of the codebase) serve a niche enterprise use case.
