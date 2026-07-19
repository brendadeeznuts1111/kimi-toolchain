/**
 * doctor-mcp-server runtime boundary — Effect.runPromise is allowed here.
 */

import { Effect, Exit } from "effect";
import { invokeCommandEffect } from "./tool-runner-effect.ts";
import type { ToolInvocation } from "../tool-runner.ts";
import type { ExitNonZero, ToolNotFound, ToolTimeout } from "./errors.ts";

// Repo layout: src/lib/effect/../bin/kimi-doctor.ts = src/bin/kimi-doctor.ts.
// Deployed layout (~/.kimi-code): lib/effect/../../tools/kimi-doctor.ts = tools/kimi-doctor.ts.
const REPO_SCRIPT = Bun.fileURLToPath(import.meta.resolve("../bin/kimi-doctor.ts"));
const DEPLOYED_SCRIPT = Bun.fileURLToPath(import.meta.resolve("../../tools/kimi-doctor.ts"));
const SCRIPT_PATH = (await Bun.file(REPO_SCRIPT).exists()) ? REPO_SCRIPT : DEPLOYED_SCRIPT;

type DoctorMcpError = ToolNotFound | ToolTimeout | ExitNonZero;

export async function runDoctorMcpCommand(
  mode: string,
  extraArgs: string[],
  cwd: string
): Promise<Exit.Exit<ToolInvocation, DoctorMcpError>> {
  const args = ["run", SCRIPT_PATH, `--${mode}`, "--json", ...extraArgs];
  return Effect.runPromiseExit(invokeCommandEffect(["bun", ...args], { cwd, tool: "kimi-doctor" }));
}
