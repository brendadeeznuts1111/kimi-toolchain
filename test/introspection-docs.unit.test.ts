import { describe, expect, test } from "bun:test";
import { join } from "path";
import { buildAgentsMd } from "../src/lib/scaffold-agents.ts";

const REPO_ROOT = join(import.meta.dir, "..");

async function readRepoFile(path: string): Promise<string> {
  return Bun.file(join(REPO_ROOT, path)).text();
}

describe("introspection docs", () => {
  test("README documents machine-readable introspection schemas", async () => {
    const readme = await readRepoFile("README.md");

    expect(readme).toContain("kimi-capabilities --json");
    expect(readme).toContain("CapabilityReport");
    expect(readme).toContain("readinessScore");
    expect(readme).toContain("kimi-trace <trace-id> --json");
    expect(readme).toContain("rootCauseChain");
    expect(readme).toContain("kimi-contract validate --json");
    expect(readme).toContain("ContractSignatureEnvelope");
    expect(readme).toContain("trusted-keys.json");
    expect(readme).toContain("x-kimi-signature");
  });

  test("agent-facing docs point future agents at capabilities, trace, and contracts", async () => {
    const files = ["AGENTS.md", "CONTEXT.md", "TEMPLATES.md", "skills/kimi-toolchain/SKILL.md"];

    for (const file of files) {
      const text = await readRepoFile(file);
      expect(text).toContain("kimi-capabilities --json");
      expect(text).toContain("kimi-trace <trace-id> --json");
      expect(text).toContain("kimi-contract validate --json");
    }
  });

  test("generated AGENTS template preserves introspection onboarding", () => {
    const generated = buildAgentsMd("example-project");

    expect(generated).toContain("kimi-capabilities --json");
    expect(generated).toContain("kimi-trace <trace-id> --json");
    expect(generated).toContain("kimi-contract validate --json");
    expect(generated).toContain("trusted-keys.json");
    expect(generated).toContain("x-kimi-signature");
  });
});
