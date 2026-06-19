# Bun Runtime Scaffold Reference

Flags, configuration, and behavior that affect `bun create`, `bun init`, and `kimi-fix` scaffold execution.

## Bun install configuration

`bun install`, `bun add`, and `bun remove` can be configured via `bunfig.toml` or environment variables.

### `bunfig.toml` — kimi-toolchain hardened defaults

`kimi-fix` deploys a hardened `bunfig.toml` that overrides Bun's defaults. These are the values scaffolded into every new project:

```toml
[install]
# dependency scope
optional = true
dev = true
peer = true
production = false
# lockfile
saveTextLockfile = true
frozenLockfile = true
dryRun = false
# resolution
exact = false
# lifecycle
ignoreScripts = false
concurrentScripts = 8
# linker
linker = "isolated"
# Experimental (Bun ≥1.3.14): symlink packages from shared global cache
globalStore = true
# paths
globalDir = "~/.bun/install/global"
globalBinDir = "~/.bun/bin"
# supply-chain
minimumReleaseAge = 259200  # 3 days
minimumReleaseAgeExcludes = ["@types/bun", "@types/node", "typescript"]

[install.cache]
dir = "~/.bun/install/cache"

[run]
# Parent-death detection: child Bun processes auto-exit when the parent dies.
# Linux: prctl(PR_SET_PDEATHSIG, SIGKILL) — kernel-delivered, no polling.
# macOS: EVFILT_PROC/NOTE_EXIT on kqueue — event-loop integrated.
# Flag auto-inherited by nested Bun processes.
noOrphans = true

[test]
# Unit tests run concurrently; smoke/integration stay sequential
concurrentTestGlob = ["test/*.unit.test.ts"]
# Fail fast in normal/CI runs
bail = 1
# Randomize order with pinned seed for reproducible failures
randomize = true
seed = 42
# Generous per-test ceiling; fast gate overrides via CLI
timeout = 30000
# Coverage is opt-in via --coverage or test:coverage scripts
coverage = false
coverageSkipTestFiles = true
smol = false

[test.reporter]
dots = true
```

Key differences from Bun defaults:

| Key                 | Bun default                           | kimi-toolchain | Why                                                  |
| ------------------- | ------------------------------------- | -------------- | ---------------------------------------------------- |
| `saveTextLockfile`  | `false`                               | `true`         | Human-readable diffs in code review                  |
| `frozenLockfile`    | `false`                               | `true`         | Reproducible installs; CI fails on drift             |
| `linker`            | `configVersion` / workspace dependent | `isolated`     | No phantom dependencies; cleaner `node_modules`      |
| `concurrentScripts` | 16                                    | 8              | Avoid thrashing on memory-constrained hosts          |
| `minimumReleaseAge` | 0                                     | 259200 (3d)    | Supply-chain safety — block brand-new packages       |
| `bail`              | unset                                 | 1              | Fail fast; don't waste CI on broken suites           |
| `randomize`         | unset                                 | true           | Catch order-dependent test bugs                      |
| `seed`              | unset                                 | 42             | Reproducible randomized runs                         |
| `noOrphans`         | false                                 | true           | Prevents zombie processes in Herdr panes, CI runners |

Bun searches for `bunfig.toml` in these paths (merged if both exist):

- `$XDG_CONFIG_HOME/.bunfig.toml` or `$HOME/.bunfig.toml`
- `./bunfig.toml` (project-local)

Bun's official `linker` default is conditional: `configVersion = 1` uses `isolated` for workspaces and `hoisted` otherwise; `configVersion = 0` uses `hoisted`. `kimi-toolchain` pins `linker = "isolated"` in scaffolded projects so the install strategy is explicit regardless of Bun's inferred defaults.

For deterministic bootstrap, run `bun create` and template postinstall hooks with a toolchain-controlled `HOME`. This makes Bun's global config lookup read `$KIMI_SCAFFOLD_HOME/.bunfig.toml` instead of an arbitrary user shell home:

```bash
export KIMI_SCAFFOLD_HOME="$HOME/.kimi-code/bun-home"
mkdir -p "$KIMI_SCAFFOLD_HOME"
bun create kimi-toolchain my-app
```

The `templates/bun-create/kimi-toolchain` postinstall honors `KIMI_SCAFFOLD_HOME` for both `bun install -g` and `kimi-fix`, and temporarily prepends `$KIMI_SCAFFOLD_HOME/.bun/bin` to `PATH` when that controlled home is set.

### Environment variables (higher priority)

| Variable                           | Description                                                     |
| ---------------------------------- | --------------------------------------------------------------- |
| `BUN_CONFIG_REGISTRY`              | npm registry URL (default: `https://registry.npmjs.org`)        |
| `BUN_CONFIG_TOKEN`                 | auth token (currently does nothing)                             |
| `BUN_CONFIG_YARN_LOCKFILE`         | save a Yarn v1-style `yarn.lock`                                |
| `BUN_CONFIG_LINK_NATIVE_BINS`      | point `bin` in `package.json` to a platform-specific dependency |
| `BUN_CONFIG_SKIP_SAVE_LOCKFILE`    | don't save a lockfile                                           |
| `BUN_CONFIG_SKIP_LOAD_LOCKFILE`    | don't load a lockfile                                           |
| `BUN_CONFIG_SKIP_INSTALL_PACKAGES` | don't install any packages; useful for dry bootstrap probes     |

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

**Eligibility** (Bun v1.3.14): a package is stored in the global store only when all of the following hold:

- Source is an **immutable cache source** — npm registry, git, or tarball — and the package is **unpatched**.
- The package has **no trusted lifecycle scripts** (packages listed in `trustedDependencies` with install scripts are ineligible).
- **Every transitive dependency** in the resolved closure meets the same criteria.

If any package in the tree is ineligible, Bun **falls back to per-project copies** for that package (and its subtree as needed). No manual toggle required.

**Entry hash:** Bun hashes the package's **resolved dependency closure**. Two projects that resolve a package to the exact same transitive versions share a single on-disk entry; different resolutions get separate entries.

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

### Scaffolded perf harness (`KIMI_MODULES=doctor`)

`kimi-fix` copies the dashboard perf harness (`examples/dashboard/src/harness/`, `examples/dashboard/src/bin/perf-doctor.ts`) when `KIMI_MODULES` is unset (default `doctor`). See [template-matrix.md](./template-matrix.md) and [kimi-doctor.md](./kimi-doctor.md) § Effects pipeline.

- Used by `herdr-orchestrator` for pane process inheritance

### Bun.Terminal on Windows (Bun ≥1.3.14)

`Bun.Terminal` and `Bun.spawn({ terminal })` now work on Windows via ConPTY.

```ts
const terminal = new Bun.Terminal({
  cols: 80,
  rows: 24,
  onData(data) {
    process.stdout.write(data);
  },
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

| Topic                             | Path                                                 |
| --------------------------------- | ---------------------------------------------------- |
| Toolchain hardened install policy | `src/lib/bun-install-config.ts`                      |
| Scaffold `bunfig.toml` template   | `templates/scaffold/bunfig.toml`                     |
| Configuration layers model        | [configuration-layers.md](./configuration-layers.md) |
| `bun create` template             | `templates/bun-create/kimi-toolchain/`               |
| `kimi-fix` source                 | `src/bin/kimi-fix.ts`                                |

## `bun create` flow

The `bun create` template is a minimal skeleton — just a `package.json` with a `bun-create.postinstall` hook. When you run `bun create kimi-toolchain my-app`, Bun copies the skeleton and then executes the two-step postinstall:

1. **`HOME="${KIMI_SCAFFOLD_HOME:-$HOME}" bun install -g github:brendadeeznuts1111/kimi-toolchain`** — ensures the toolchain is available in the selected Bun home (idempotent — fast no-op if already installed)
2. **`HOME="${KIMI_SCAFFOLD_HOME:-$HOME}" PATH="..." kimi-fix .`** — runs the full scaffold: hardened `bunfig.toml`, `dx.config.toml`, `tsconfig.json`, `AGENTS.md`, `.oxfmtrc.json`, CI workflow, governance files, git hooks

The `bun-create` section is auto-stripped from the destination `package.json` by Bun.

```bash
# One-time setup
cp -r ~/kimi-toolchain/templates/bun-create/kimi-toolchain ~/.bun-create/
export KIMI_SCAFFOLD_HOME="$HOME/.kimi-code/bun-home"

# Then create projects from anywhere
bun create kimi-toolchain my-app
cd my-app
bun run check:fast
```
