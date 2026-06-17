---
name: cloudflare-access
description: |
  Cloudflare Access / Zero Trust hygiene — service token expiry, local inventory,
  policy audit, policy-as-code. Use when Access tokens, app policies, or
  `.cloudflare-access.yml` drift need inspection or controlled apply.
whenToUse: |
  Service token expiry warnings, Access app policy gaps, dx.config Cloudflare
  snapshot/dashboard, or policy-as-code plan/apply. Not for Workers deploy
  (use wrangler skill) or MCP SSO login (separate auth path).
layer: L2
trigger:
  - Access token expiry or inventory
  - policy audit or plan/apply
  - MCP vs Wrangler auth confusion
dependencies: []
loaded_by: System / On-demand
role: Cloudflare Access hygiene — tokens, policies, plan-before-apply
token_estimate: 520
allowed_tools:
  - read_file
  - write_file
  - search_content
  - run_command
  - web_fetch
run_as: subagent
model: deepseek-v4-flash
---

# Cloudflare Access — Zero Trust hygiene

Before API calls, confirm credentials exist:

```bash
kimi-cloudflare-access status    # read-only inventory — no token required for local scan
kimi-cloudflare-access doctor    # fails fast when account id / API token missing
```

If `doctor` reports missing credentials, run `kimi-cloudflare-access login` or set `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` for CI.

**Auth separation:** Cloudflare MCP SSO/OAuth, Wrangler OAuth, and this CLI's API token are independent. A successful MCP or Wrangler login does not satisfy `kimi-cloudflare-access` unless the account id and API token are also available. See [UNIFIED.md](~/.kimi-code/UNIFIED.md).

Implementation: `src/lib/cloudflare-access.ts`, `src/lib/cloudflare-access-policy.ts`, `src/lib/cloudflare-integration-status.ts`, `src/bin/kimi-cloudflare-access.ts`. Exemplars: [CODE_REFERENCES.md](~/.kimi-code/CODE_REFERENCES.md) § Cloudflare Access.

## Commands

```bash
kimi-cloudflare-access status       # local inventory (credentials, MCP, wrangler, project files)
kimi-cloudflare-access dashboard    # DX homepage/dashboard snapshot (--json for machines)
kimi-cloudflare-access tokens       # service token expiry audit (default subcommand)
kimi-cloudflare-access apps         # Access application policy audit
kimi-cloudflare-access doctor       # full hygiene check
kimi-cloudflare-access fix          # rotate expired/expiring service tokens
kimi-cloudflare-access plan         # policy-as-code dry-run (.cloudflare-access.yml)
kimi-cloudflare-access apply        # mutates Access apps/policies — user confirmation required
kimi-cloudflare-access mcp-apply    # emit MCP script for policy updates (no direct API apply)
kimi-cloudflare-access login        # store credentials in OS keychain (Bun.secrets)
kimi-cloudflare-access logout       # remove stored credentials
```

**Always** run `plan` before `apply`. Show the planned app/policy diff and get explicit user confirmation before `apply`.

API token permissions (https://dash.cloudflare.com/profile/api-tokens):

- Account → Cloudflare Access → Read
- Account → Access: Service Tokens → Read

## Recipes

### weekly token expiry sweep

```bash
kimi-cloudflare-access doctor --json
kimi-cloudflare-access tokens --json
# IF expiring within policy window → show user list, then:
# discuss with user before mutating tokens:
kimi-cloudflare-access fix
```

### policy-as-code change (safe path)

```bash
# 1. Edit .cloudflare-access.yml in project root (see dx.config.toml [cloudflare] policyFile)
kimi-cloudflare-access plan
# 2. Present diff to user; stop if unexpected mutations
kimi-cloudflare-access apply          # only after explicit approval
```

### local inventory before touching production

```bash
kimi-cloudflare-access status
kimi-cloudflare-access dashboard --json
```

Use this when Wrangler/MCP auth works but Access CLI fails — usually missing dedicated API token.

## Related

- [UNIFIED.md](~/.kimi-code/UNIFIED.md) — Kimi Code vs kimi-toolchain; Cloudflare auth matrix
- [skills/kimi-toolchain/SKILL.md](~/.kimi-code/skills/kimi-toolchain/SKILL.md) — toolchain decision protocol
- [CODE_REFERENCES.md](~/.kimi-code/CODE_REFERENCES.md) — parser/diff exemplars and test pointers

## Do not

- Run `apply` without a prior `plan` and user confirmation.
- Assume Wrangler or MCP login satisfies this CLI.
- Commit API tokens or `.env` files with Cloudflare secrets.
