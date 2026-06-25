#!/usr/bin/env bun
/** Block new manual path dispatch in herdr-dashboard router (staged additions only). */

import { $ } from "bun";
import { createLogger } from "../src/lib/logger.ts";

const TOOL = "lint-serve-routes-staged";
const logger = createLogger(Bun.argv, TOOL);
const ROUTER = "src/lib/herdr-dashboard/server/router.ts";
const MANUAL_DISPATCH =
  /^\+\s*(?:\}\s*)?(?:else\s+)?if\s*\(\s*path\s*(?:===|\.startsWith\s*\(|\.endsWith\s*\(|\.includes\s*\()/;

async function main(): Promise<void> {
  const diff = await $`git diff --cached -U0 -- ${ROUTER}`.quiet().nothrow();
  if (diff.exitCode !== 0) {
    const msg = diff.stderr.toString().trim() || diff.stdout.toString().trim();
    logger.error(`${TOOL}: git diff failed — ${msg || `exit ${diff.exitCode}`}`);
    process.exit(1);
  }

  const text = diff.stdout.toString();
  if (!text.trim()) {
    logger.info(`${TOOL}: router.ts not staged — skip`);
    process.exit(0);
  }

  const hits = text
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .filter((line) => MANUAL_DISPATCH.test(line));

  if (hits.length > 0) {
    logger.error(`${TOOL}: new manual path dispatch — use Bun.serve({ routes }) or URLPattern`);
    for (const line of hits) logger.error(`  ${line}`);
    process.exit(1);
  }

  logger.info(`${TOOL}: 0 new manual path dispatch violations`);
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
