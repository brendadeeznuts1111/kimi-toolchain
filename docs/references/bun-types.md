# Bun TypeScript types reference

Bun ships its TypeScript type definitions in the same repo as the runtime:
`packages/bun-types` in `oven-sh/bun`. Most users install the convenience
package `@types/bun`, which is a thin shim that re-exports `bun-types`.

## Upstream source

- **Runtime repo**: https://github.com/oven-sh/bun
- **Type definitions tree**: https://github.com/oven-sh/bun/tree/main/packages/bun-types
- **Convenience npm package**: `@types/bun`

## How Bun types are loaded

`@types/bun` is an ordinary npm dev-dependency. TypeScript automatically loads
any `@types/*` package into a project, so adding the dependency makes the `Bun`
global and the `bun:*` module namespace available without further configuration.

```bash
bun add -D @types/bun
```

For Bun versions before the types were split out, types were bundled inside the
Bun binary itself. Modern Bun uses the separate `bun-types` package so the type
surface can be versioned and updated independently of the runtime release
cadence.

## How kimi-toolchain pins Bun types

This repo uses a local checkout of `bun-types` so it can track canary APIs
before they appear in an npm release:

```toml
# tsconfig.json
{
  "compilerOptions": {
    "types": ["bun-types"]
  }
}
```

```toml
# package.json (simplified)
"devDependencies": {
  "bun-types": "file:../bun/packages/bun-types"
}
```

The relative path `file:../bun/packages/bun-types` assumes the Bun source repo
is cloned as a sibling of `kimi-toolchain`. When that checkout is missing,
`bun install` falls back to the version range declared for `@types/bun`.

## Updating the local types checkout

1. Pull the latest Bun source:
   ```bash
   cd ../bun && git pull origin main
   ```
2. Re-install dependencies so the symlink resolves to the new checkout:
   ```bash
   cd ../kimi-toolchain && bun install
   ```
3. Run typecheck to catch any API drift:
   ```bash
   bun run typecheck
   ```

## Adding a new type file upstream

When contributing a new definition back to Bun:

1. Add the new `.d.ts` file under `packages/bun-types` in the Bun repo.
2. Add a triple-slash reference to it in `packages/bun-types/index.d.ts`:
   ```ts
   /// <reference path="./newfile.d.ts" />
   ```
3. Build the package:
   ```bash
   bun build
   ```

## Related docs

- `docs/references/bun-runtime-scaffold.md` for runtime APIs.
- `docs/references/bunfig-config.md` for Bun configuration.
- `docs/references/bun-install-config.md` for package-manager policy.
