/**
 * Compile-time metadata injected by `scripts/build-release-binaries.ts` via `bun build --define`.
 * Not listed in bunfig.toml [define] — undefined when running from source.
 * @see src/lib/version.ts
 */

declare const KIMI_BUILD_VERSION: string | undefined;
declare const KIMI_BUILD_TIME: string | undefined;
declare const KIMI_GIT_COMMIT: string | undefined;
declare const KIMI_BUILD_CHANNEL: string | undefined;
