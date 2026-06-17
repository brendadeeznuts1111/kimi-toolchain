#!/usr/bin/env bun
// Plugin event hook: auto-bootstrap a workspace when it is created,
// if the project directory contains a Herdr profile.

import { $ } from "bun";

const event = safeJson(process.env.HERDR_PLUGIN_EVENT_JSON, {});
const workspace = event.workspace || {};
const cwd = workspace.cwd || event.workspace_cwd;

if (!cwd) {
  console.error("[dev.kimi-toolchain:on-workspace-created] no workspace cwd");
  process.exit(0);
}

console.error(`[dev.kimi-toolchain:on-workspace-created] ${workspace.workspace_id || event.workspace_id || "?"} cwd=${cwd}`);

try {
  const hasConfig = await $`herdr-project has-config ${cwd}`.cwd(cwd).quiet();
  if (hasConfig.exitCode === 0) {
    await $`herdr-project bootstrap ${cwd}`.cwd(cwd);
  } else {
    console.error("no herdr profile found; skipping bootstrap");
  }
} catch (err) {
  console.error("auto-bootstrap failed:", err);
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
