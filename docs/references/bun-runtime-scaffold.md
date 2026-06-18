# Bun Runtime Scaffold Reference

Flags, configuration, and behavior that affect `bun create`, `bun init`, and `kimi-fix` scaffold execution.

## Bun install configuration

`bun install`, `bun add`, and `bun remove` can be configured via `bunfig.toml` or environment variables.

### `bunfig.toml` (optional)

Bun searches for `bunfig.toml` in these paths (merged if both exist):
- `$XDG_CONFIG_HOME/.bunfig.toml` or `$HOME/.bunfig.toml`
- `./bunfig.toml` (project-local)

Default values shown below:

```toml
[install]

# whether to install optionalDependencies
optional = true

# whether to install devDependencies
dev = true

# whether to install peerDependencies
peer = true

# equivalent to `--production` flag
production = false

# equivalent to `--save-text-lockfile` flag
saveTextLockfile = false

# equivalent to `--frozen-lockfile` flag
frozenLockfile = false

# equivalent to `--dry-run` flag
dryRun = false

# equivalent to `--concurrent-scripts` flag
concurrentScripts = 16 # (cpu count or GOMAXPROCS) x2

# installation strategy: "hoisted" or "isolated"
# default depends on lockfile configVersion and workspaces:
# - configVersion = 1: "isolated" if using workspaces, otherwise "hoisted"
# - configVersion = 0: "hoisted"
linker = "hoisted"

# minimum age config
minimumReleaseAge = 259200 # seconds
minimumReleaseAgeExcludes = ["@types/node", "typescript"]
```

### Environment variables (higher priority)

| Variable | Description |
|----------|-------------|
| `BUN_CONFIG_REGISTRY` | npm registry URL (default: `https://registry.npmjs.org`) |
| `BUN_CONFIG_TOKEN` | auth token (currently does nothing) |
| `BUN_CONFIG_YARN_LOCKFILE` | save a Yarn v1-style `yarn.lock` |
| `BUN_CONFIG_LINK_NATIVE_BINS` | point `bin` in `package.json` to a platform-specific dependency |
| `BUN_CONFIG_SKIP_SAVE_LOCKFILE` | don't save a lockfile |
| `BUN_CONFIG_SKIP_LOAD_LOCKFILE` | don't load a lockfile |
| `BUN_CONFIG_SKIP_INSTALL_PACKAGES` | don't install any packages |

### Installation backend

Bun always tries the fastest available method:
- **macOS:** `clonefile`
- **Linux:** `hardlink`

You can override with the `--backend` flag. On error, Bun falls back to copying files.

### Global virtual store (experimental, Bun ≥1.3.14)

When using `linker = "isolated"`, you can enable a shared global store to dramatically speed up warm installs:

```toml
[install]
linker = "isolated"
globalStore = true
```

This materialises each package only once in `~/.bun/install/cache/links/`, and projects symlink to it. Warm installs (lockfile present, cache warm, `node_modules` wiped) become ~7× faster on macOS (115 ms vs 823 ms for a 1,400-package fixture). Ineligible packages fall back to per-project copies automatically.

Environment variable override: `BUN_INSTALL_GLOBAL_STORE=1 bun install`

**Important:** The feature is still experimental and off by default. It requires `linker = "isolated"` and will not work with `hoisted`. We recommend testing it in your environment before enabling globally.

### Cache and lazy installation

Packages are stored in `~/.bun/install/cache/${name}@${version}` (build/pre tags are hashed).

When `node_modules` exists, Bun checks the `package.json` of the installed package to decide if a reinstall is needed (uses a fast custom JSON parser).

If `bun.lock` is missing or `package.json` changed, tarballs are downloaded eagerly. If `bun.lock` exists and `package.json` unchanged, missing dependencies are downloaded lazily.

## Bun runtime features (Bun ≥1.3.14)

### `process.execve()` — replace process image

Bun implements `process.execve(execPath, args, env)` (Node.js v24 API). This POSIX syscall replaces the current process in-place — it never returns on success.

```ts
process.execve("/usr/bin/echo", ["echo", "hello"], { PATH: process.env.PATH });
// This line is never reached on success.
```

- Inherits stdio (fd 0/1/2); other fds are marked close-on-exec.
- Resets signal mask.
- Throws in worker threads or on Windows.
- Emits `ExperimentalWarning` once per process.

Useful for toolchain scripts that need to swap out their own executable (e.g., after an update).

The toolchain ships a typed handoff wrapper at `src/lib/execve-handoff.ts`:

- `execveSupported()` — true on POSIX main thread
- `handoffInheritedSpawn(file, args, env)` — execve when gated (via `KIMI_HANDOFF_EXECVE=1`), else falls back to `Bun.spawn` + exit code pass-through
- Used by `herdr-orchestrator` for pane process inheritance

### Bun.Terminal on Windows (Bun ≥1.3.14)

`Bun.Terminal` and `Bun.spawn({ terminal })` now work on Windows via ConPTY.

```ts
const terminal = new Bun.Terminal({
  cols: 80,
  rows: 24,
  onData(data) { process.stdout.write(data); },
});
const proc = Bun.spawn({ cmd: ["cmd.exe", "/c", "echo", "hello"], terminal });
await proc.exited;
terminal.close();
```

Platform differences:
- No termios — input/output flags are no-ops.
- No echo without a child process (ConPTY lacks line discipline).
- ConPTY may re-encode escape sequences (colors/text preserved, cursor sequences may be coalesced).

### Explicit Resource Management (`using` / `await using`)

When targeting Bun (`--target=bun`), `using` and `await using` are left as-is (no transpilation to helper functions). This applies to `bun run`, `Bun.Transpiler({ target: "bun" })`, and `bun build --target=bun`.

This improves runtime performance and avoids CommonJS wrapper bugs (e.g., `.cjs` files).

## Related

| Topic | Path |
|-------|------|
| Toolchain hardened install policy | `src/lib/bun-install-config.ts` |
| Scaffold `bunfig.toml` template | `templates/scaffold/bunfig.toml` |
| Configuration layers model | [configuration-layers.md](./configuration-layers.md) |
| `bun create` template | `templates/bun-create/kimi-toolchain/` |
| `kimi-fix` source | `src/bin/kimi-fix.ts` |
