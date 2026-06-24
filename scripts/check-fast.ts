#!/usr/bin/env bun
/**
 * Fast check gate — lint names, typecheck, unit tests, release SSOT.
 *
 *   bun run check:fast
 */

import { $ } from "bun";

await $`bun run lint:names`;
await $`bun run typecheck`;
await $`bun run test:unit`;
await $`bun run validate:release-ssot -- --skip-blog-audit`;
