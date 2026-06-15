/**
 * effect/config.ts — Effect Config for kimi-toolchain runtime settings.
 */

import { Config, Effect } from "effect";
import { defaultToolTimeoutMs, isAgentContext } from "../tool-runner.ts";
import { desktopRoot, homeDir } from "../paths.ts";

export interface ToolchainConfig {
  home: string;
  desktopRoot: string;
  isAgentContext: boolean;
  defaultToolTimeoutMs: number;
  sessionId: string | undefined;
}

export const ToolchainConfigLive = Effect.sync(
  (): ToolchainConfig => ({
    home: homeDir(),
    desktopRoot: desktopRoot(),
    isAgentContext: isAgentContext(),
    defaultToolTimeoutMs: defaultToolTimeoutMs(),
    sessionId: Bun.env.KIMI_CODE_SESSION || Bun.env.KIMI_AGENT_SESSION || undefined,
  })
);

export const telemetryEnabled = Config.boolean("KIMI_TOOLCHAIN_TELEMETRY").pipe(
  Config.withDefault(false)
);
