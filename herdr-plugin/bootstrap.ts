#!/usr/bin/env bun
// Plugin action: bootstrap the current workspace using herdr-project.
// Triggered by: herdr plugin action.invoke dev.kimi-toolchain.bootstrap

import { $ } from "bun";

const context = safeJson(process.env.HERDR_PLUGIN_CONTEXT_JSON, {});
const cwd = context.workspace_cwd || context.workspace?.cwd || process.cwd();

console.error(`[dev.kimi-toolchain:bootstrap] workspace=${context.workspace_id || "?"} cwd=${cwd}`);

try {
  await $`herdr-project bootstrap ${cwd}`.cwd(cwd);
} catch (err) {
  console.error("bootstrap failed:", err);
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
