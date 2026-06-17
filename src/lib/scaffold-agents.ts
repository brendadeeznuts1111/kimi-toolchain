/**
 * AGENTS.md scaffold for new projects — mirrors TEMPLATES.md minimal template.
 */

import { homeDir } from "./paths.ts";

export function buildAgentsMd(projectName: string, home = homeDir()): string {
  const dxAgentsPath = `${home}/.config/dx/AGENTS.md`;
  return `# Agent Guide — ${projectName}

## Project

One-line description of what this does.

## Runtime

- **Bun** \`>=1.3.14\` — check \`bun --version\`
- Prefer Bun-native APIs: \`Bun.file\`, \`Bun.serve\`, \`Bun.hash\`, \`Bun.sleep\`
- No Node APIs unless Bun lacks equivalent (see \`~/.kimi-code/AGENTS.md\` for full table)

## Global DX First

- Read \`${dxAgentsPath}\` before project-local setup
- Start with \`dx setup\`, \`dx context\`, \`dx config\`, \`dx mcp-status\`, \`dx cli\`, and \`dx package\`
- Use \`dx package\` after dependency changes, then rerun Kimi guardian/governance gates

## Formatting & lint

- **oxfmt** — \`.oxfmtrc.json\`, \`bun run format\` / \`bun run format:check\`
- **oxlint** — \`.oxlintrc.json\`, \`bun run lint\`
- Run \`bun run format\` before commit; CI uses \`format:check:ci\` + \`lint\`

## Conventions

- Zero re-export shims — import from canonical source
- Inline single-use variables and private methods
- \`trash\` > \`rm\`
- Read-only checks before mutation (\`--dry-run\`)
- Use \`Bun.env\` for environment reads
- Use \`Bun.cwd\` not \`process.cwd()\`
- Use \`Bun.argv\` not \`process.argv\`
- Use \`Uint8Array\` not \`Buffer\`
- Prefer shared tool/logging helpers from \`~/.kimi-code/AGENTS.md\` over raw subprocess and console patterns

## Reference Code Before Writing

- Read local \`./CODE_REFERENCES.md\` before adding new modules or tool paths
- If local references are incomplete, fall back to \`~/.kimi-code/CODE_REFERENCES.md\`
- Match the closest existing pattern for logging, tool invocation, config parsing, and tests
- For Effect code, use it only when the project already uses it or the workflow needs typed failures, cleanup, subprocess orchestration, or parallel aggregation
- For config/schema work, prefer narrow interfaces, type guards, parser checks, and focused validation tests before adding schema packages

## Agent Defaults

- Preserve dirty worktrees; never revert user changes without explicit instruction
- Keep destructive operations and dependency changes in manual approval mode
- Do not use YOLO/auto-approve for mutation-heavy MCP or shell operations
- Keep background keep-alive off unless intentionally daemonizing
- Batch related edits, then run targeted tests before broad gates

## Commands

\`\`\`bash
bun run dev           # Dev server (auto-port)
bun run test          # Tests (fail-fast)
bun run typecheck     # tsc --noEmit
bun run format        # oxfmt --write .
bun run format:check  # oxfmt --check . (local)
bun run lint          # oxlint
kimi-fix .            # Auto-fix scaffolding
\`\`\`

## Quality Gates

\`\`\`bash
kimi-doctor --agent-ready
kimi-githooks doctor
bun run check:fast
bun run check
kimi-guardian check
kimi-governance score
kimi-context-gen scan
kimi-githooks install
kimi-doctor --quick
\`\`\`

## Kimi Code

- User MCP: \`~/.kimi-code/mcp.json\` (unified-shell from toolchain sync)
- Cloudflare MCP default: \`cloudflare-api\` in user MCP; Cloudflare SSO/OAuth is separate from Wrangler OAuth and \`kimi-cloudflare-access\` API tokens
- Project override: \`.kimi-code/mcp.json\` (empty stub unless you add stdio servers)
- Skills: \`.kimi-code/skills/<name>/SKILL.md\`

## References

- \`CONTEXT.md\` — domain model and architecture
- \`CODE_REFERENCES.md\` — local exemplars for good code patterns
- \`.env.example\` — required environment variables
- \`docs/adr/\` — architecture decision records
- \`~/.kimi-code/AGENTS.md\` — global agent rules
- \`~/.kimi-code/CODE_REFERENCES.md\` — fallback global exemplar map
- \`~/.kimi-code/UNIFIED.md\` — Kimi Code vs kimi-toolchain map
- \`~/.kimi-code/TEMPLATES.md\` — scaffold templates
`;
}
