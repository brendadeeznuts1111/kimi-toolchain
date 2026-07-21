# Bun install configuration reference

This doc summarises the install-scoped keys Bun reads from `bunfig.toml`.
It is intended as a quick reference for how `kimi-toolchain` configures and
audits Bun package-manager behaviour.

## Where install config lives

All install keys live under the `[install]` table. Optional sub-tables include
`[install.cache]`, `[install.scopes]`, and per-dependency platform selectors.

```toml
[install]
cacheDir = "~/.bun/install/cache"
globalDir = "~/.bun/install/global"
registry = "https://registry.npmjs.org"
exact = false
frozenLockfile = true
hoist = true
optional = true
peer = true
dev = true
saveTextLockfile = true

[install.cache]
dir = "~/.bun/install/cache"
disable = false

[install.scopes.myorg]
registry = "https://npm.myorg.com"
```

## Common `[install]` fields

| Field              | Default                      | Purpose                                                          |
| ------------------ | ---------------------------- | ---------------------------------------------------------------- |
| `cacheDir`         | platform default             | Directory for downloaded package tarballs.                       |
| `globalDir`        | platform default             | Directory for `bun install -g` packages.                         |
| `registry`         | `https://registry.npmjs.org` | Default npm registry URL.                                        |
| `frozenLockfile`   | `false`                      | Refuse to update the lockfile; useful for CI.                    |
| `exact`            | `false`                      | Save exact versions instead of semver ranges.                    |
| `hoist`            | `true`                       | Hoist compatible dependencies to `node_modules`.                 |
| `optional`         | `true`                       | Install `optionalDependencies`.                                  |
| `peer`             | `true`                       | Install peer dependencies when missing.                          |
| `dev`              | `true`                       | Install `devDependencies`.                                       |
| `production`       | `false`                      | Skip `devDependencies`.                                          |
| `saveTextLockfile` | `false`                      | Write a human-readable text lockfile in addition to `bun.lockb`. |
| `lockfile`         | `{ print = "yarn" }`         | Lockfile output format options.                                  |
| `timeout`          | `0` (no timeout)             | Network request timeout in milliseconds.                         |

## `frozenLockfile` and intentional dep changes

`frozenLockfile = true` (machine + repo policy) refuses any lockfile update,
which also blocks `bun remove` and plain `bun install` after a manual
`package.json` edit ("lockfile had changes, but lockfile is frozen").

There is **no runtime override**: the `BUN_CONFIG_*` env table does not include
`frozenLockfile`, `--frozen-lockfile` takes no value, and `--no-frozen-lockfile`
is not honored (verified against bun.com/docs/pm/cli/install on Bun 1.4.0).
The only working path for an intentional dep change:

1. Edit `package.json` (or use `bun add` / `bun remove` / `bun update`).
2. Temporarily set `frozenLockfile = false` in repo `bunfig.toml`.
3. Run `bun install` (updates `bun.lock`).
4. **Immediately restore `frozenLockfile = true`** and verify `git diff bunfig.toml` is empty.

The desktop-runtime provisioner sidesteps this differently: it deletes the
disposable runtime lockfile before install — frozen only hard-fails on an
_outdated_ lockfile, not a missing one.

## `[install.cache]`

| Field     | Default          | Purpose                               |
| --------- | ---------------- | ------------------------------------- |
| `dir`     | platform default | Override the install cache directory. |
| `disable` | `false`          | Disable the install cache entirely.   |

Bun treats the cache as immutable. `kimi-doctor --gate bunfig-policy` verifies
that the repo `bunfig.toml` does not duplicate machine-level cache settings.

## Scoped registries

Scoped registries route packages matching a scope to a different registry and
optional auth token:

```toml
[install.scopes."@myorg"]
registry = "https://npm.myorg.com"
url = "https://npm.myorg.com"
token = "$NPM_TOKEN_MYORG"
```

`kimi-toolchain` audits scopes in `canonical-references.toml` and via
`kimi-cloudflare-access` for private registry tokens.

## Platform-specific dependencies

`optionalDependencies` can declare per-OS and per-CPU requirements with the
`os` and `cpu` fields in `package.json`. Bun skips dependencies whose platform
selector does not match the current host. `bun install` also accepts `--cpu`
and `--os` flags to override the host platform for lockfile resolution.

## Trusted dependencies and lifecycle scripts

`trustedDependencies` in `package.json` lists packages allowed to run lifecycle
scripts. Bun blocks lifecycle scripts for packages not in this list. The
`bunfig.toml` `[install]` table does not configure trusted dependencies; they
are declared per-project in `package.json`.

## Links and workspaces

| Field                     | Purpose                                                                      |
| ------------------------- | ---------------------------------------------------------------------------- |
| `link-workspace-packages` | Prefer workspace versions over registry versions for matching semver ranges. |

Bun workspaces are declared in `package.json` `workspaces`; `bunfig.toml` only
controls install policy for those workspaces.

## Related docs

- `docs/references/bunfig-config.md` for runtime, test, serve, and `bun run` keys.
- `docs/references/bun-runtime-scaffold.md` for Bun APIs and script execution.
- `bunfig.toml` in the repo root for the live project policy.
