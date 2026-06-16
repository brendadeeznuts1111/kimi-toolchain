import { execFileSync } from "node:child_process";

export const AGENT_COMMANDS: Record<string, string[]> = {
  codex: ["codex"],
  kimi: ["kimi"],
  grok: ["grok"],
  hermes: ["hermes"],
  claude: ["claude"],
  cursor: ["cursor-agent"],
};

export const MIN_INTEGRATION_VERSIONS: Record<string, number> = {
  pi: 2,
  claude: 6,
  codex: 5,
  cursor: 1,
  copilot: 2,
  devin: 1,
  droid: 2,
  kimi: 3,
  qodercli: 2,
  opencode: 5,
  kilo: 1,
  hermes: 2,
};

export const REQUIRED_INTEGRATIONS = ["codex", "kimi", "hermes", "claude", "cursor"] as const;

export const SPAWN_AGENTS = ["codex", "kimi", "hermes", "grok", "claude"] as const;

export const SCREEN_DETECTED_AGENTS = ["grok"] as const;

function which(command: string): string | null {
  try {
    const output = execFileSync("which", [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

export function resolveAgentArgv(agentName: string): string[] {
  const candidates = AGENT_COMMANDS[agentName] || [agentName];
  for (const candidate of candidates) {
    const found = which(candidate);
    if (found) return [found];
  }
  return candidates;
}

export function resolveAgentPath(agentName: string): string {
  return resolveAgentArgv(agentName)[0];
}
