---
title: "Naming"
tags: [core]
category: core
status: draft
priority: medium
---
# CLI naming notes

See [namespace.md](./references/namespace.md) for the full toolchain vs Herdr plugin disambiguation table.

- `kimi-doctor --session-report` is **deprecated** — use `--effect-floor` (effect-discipline floor counts, not Herdr session health).
- `herdr-doctor` (Herdr **plugin**) is not `kimi-doctor` — see [namespace.md § Doctor trinity](./references/namespace.md#doctor-trinity--kimi-code). The in-repo **`herdr-doctor` bin** (`src/bin/herdr-doctor.ts`) is DX/Herdr integration health — also documented there. No `--session-report` or `--effect-floor` on the plugin.
## Related

- [INDEX.md](../INDEX.md) — Documentation index
