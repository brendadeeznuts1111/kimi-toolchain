# Shell Spawn Choice Reference

This document is the decision matrix for spawning subprocesses in `kimi-toolchain`. It applies to all `src/lib/` and `src/bin/` code.

## Decision Matrix

| Need                                   | Use                                                        | Avoid                                | Why                                                                                            |
| -------------------------------------- | ---------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Cross-tool calls inside the toolchain  | `invokeTool()` / `runTool()` from `src/lib/tool-runner.ts` | Raw `Bun.spawn(["bun", "run", ...])` | Bounded output, timeout, env overlay, taxonomy enrichment, and uniform `ToolInvocation` shape. |
| Effect audit + automated repair        | `invokeTool("kimi-heal", ["--fix", "--yes"])`              | Manual regex edits in source         | Centralized repair logic in `src/lib/effect-heal-fix.ts`; always `--dry-run` first in CI.      |
| One-off shell commands with piping     | `import { $ } from "bun"`                                  | `node:child_process`                 | Bun's `$` handles shell syntax, escaping, and streaming with Bun-native ergonomics.            |
| Low-level process control              | `Bun.spawn()` / `Bun.spawnSync()`                          | `node:child_process`                 | Fine-grained control over stdio, env, and lifecycle.                                           |
| Resource-limited or governed execution | `governedSpawn()` from `src/lib/governor-spawn.ts`         | Unbounded raw spawn                  | Enforces memory/CPU/time budgets and global spawn limits.                                      |

## Rules

1. **Prefer `invokeTool()` / `runTool()`** when calling another `kimi-*` tool. This is the canonical cross-tool contract.
2. **Use `Bun.$`** only for throwaway shell ergonomics (piping, globs, shell built-ins). Do not use it for toolchain tool calls.
3. **Use `Bun.spawn()`** when you need direct control over stdio, lifecycle, or binary executables that are not toolchain tools.
4. **Use `governedSpawn()`** when the operation must respect resource budgets or when spawning from a context that already tracks limits.
5. **Never import `node:child_process`** or `node:events` for process work. The Bun-native lint gate (`scripts/lint-bun-native.ts`, run via `bun run bun-native:check`) rejects these with phased baseline ratchet — see `bun-native-lint.toml`. `lint-patterns.ts` in `bun run lint` covers `console.*` and `process.exit` in `src/lib/`.

## Environment Handling

- Use the `env` overlay on `invokeTool()` / `invokeCommand()` instead of mutating `Bun.env` for a child process.
- Merge behavior removes keys set to `undefined`, preserving the parent environment for all other keys.

## Output Handling

- Respect `maxOutputBytes` to avoid unbounded memory growth on long-running commands.
- Preserve `stdoutTruncated` / `stderrTruncated` markers in higher-level reports when relevant.
- For live streaming UX, stream the returned output at the router boundary while keeping the tool-runner contract.
