---
name: { { SKILL_NAME } }
description: |
  One sentence: what capability this skill provides.
  Second sentence: when agents should load it (specific triggers, files, or contexts).
whenToUse: |
  Concrete scenarios — user phrases, file paths, gate failures, or workspace state
  that should cause an agent to load this skill instead of improvising.
layer: L1
trigger:
  - first trigger phrase or context
  - second trigger phrase or context
dependencies: []
loaded_by: System / On-demand
role: One-line loader summary — what the skill owns vs what it delegates
token_estimate: 400
run_as: inline
metadata:
  companionSkills: []
---

# {{Skill Title}} (L1)

Lean runbook — load on `trigger` above.

## Quick start

```bash
# Minimal working command or check
```

## Workflows

1. Step one
2. Step two

## Related

- Depth doc: `~/.kimi-code/CODE_REFERENCES.md`
- Companion skill: `effect-discipline` (example — remove or replace)
