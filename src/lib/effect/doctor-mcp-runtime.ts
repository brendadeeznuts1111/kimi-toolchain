/**
 * doctor-mcp-server runtime boundary — Effect.runPromise is allowed here.
 */

import { Effect, Exit } from "effect";
import { invokeCommandEffect } from "./tool-runner-effect.ts";
import type { ToolInvocation } from "../tool-runner.ts";
import type { ExitNonZero, ToolNotFound, ToolTimeout } from "./errors.ts";

const SCRIPT_PATH = new URL("../bin/kimi-doctor.ts", import.meta.url).pathname;

type DoctorMcpError = ToolNotFound | ToolTimeout | ExitNonZero;

export async function runDoctorMcpCommand(
  mode: string,
  extraArgs: string[],
  cwd: string
): Promise<Exit.Exit<ToolInvocation, DoctorMcpError>> {
  const args = ["run", SCRIPT_PATH, `--${mode}`, "--json", ...extraArgs];
  return Effect.runPromiseExit(invokeCommandEffect(["bun", ...args], { cwd, tool: "kimi-doctor" }));
}
