#!/usr/bin/env bun
/** Block new manual path dispatch in herdr-dashboard router (staged additions only). */

import { $ } from "bun";

const ROUTER = "src/lib/herdr-dashboard/server/router.ts";
const MANUAL_DISPATCH =
  /^\+\s*(?:\}\s*)?(?:else\s+)?if\s*\(\s*path\s*(?:===|\.startsWith\s*\(|\.endsWith\s*\(|\.includes\s*\()/;

const diff = await $`git diff --cached -U0 -- ${ROUTER}`.quiet().nothrow();
const PREFIX = "lint-serve-routes-staged";

if (diff.exitCode !== 0) {
  const msg = diff.stderr.toString().trim() || diff.stdout.toString().trim();
  console.error(`${PREFIX}: git diff failed — ${msg || `exit ${diff.exitCode}`}`);
  process.exit(1);
}

const text = diff.stdout.toString();
if (!text.trim()) {
  console.log(`${PREFIX}: router.ts not staged — skip`);
  process.exit(0);
}

const hits = text
  .split("\n")
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  .filter((line) => MANUAL_DISPATCH.test(line));

if (hits.length > 0) {
  console.error(`${PREFIX}: new manual path dispatch — use Bun.serve({ routes }) or URLPattern`);
  for (const line of hits) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`${PREFIX}: 0 new manual path dispatch violations`);