#!/usr/bin/env bun
// Plugin action: reconcile workspace layout.

import { $ } from "bun";

const context = safeJson(process.env.HERDR_PLUGIN_CONTEXT_JSON, {});
const cwd = context.workspace_cwd || context.workspace?.cwd || process.cwd();

console.error(`[dev.kimi-toolchain:reconcile] workspace=${context.workspace_id || "?"} cwd=${cwd}`);

try {
  await $`herdr-project reconcile ${cwd} --apply`.cwd(cwd);
} catch (err) {
  console.error("reconcile failed:", err);
  process.exit(1);
}

function safeJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
