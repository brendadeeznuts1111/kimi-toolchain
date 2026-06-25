import { describe, expect, test } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import {
  AGENTS_SYNC_BINS_BEGIN,
  AGENTS_SYNC_BINS_END,
  AGENTS_SYNC_LIB_DOMAINS_BEGIN,
  AGENTS_SYNC_LIB_DOMAINS_END,
  buildBinInventoryBlock,
  buildEndpointsBlock,
  buildLibDomainsBlock,
  checkAgentsMdSync,
  patchBinCounts,
  patchGateNames,
  syncAgentsMd,
} from "../src/lib/agents-md-sync.ts";
import { readDxEndpoints, readLibDomainRows, readPackageBins } from "../src/lib/agents-md-sync.ts";

const SAMPLE_AGENTS = `## Architecture

### Top-level directories

| Directory | Contents |
| --------- | -------- |
| \`src/bin/\` | CLI entry points (2 registered bins in \`package.json\` \`bin\`). |
| \`src/gates/\` | Built-in execution gates (\`old-gate\`). |

### Registered CLI bins (\`package.json\` \`bin\`)

${AGENTS_SYNC_BINS_BEGIN}

| Bin | Entry |
| --- | ----- |
| \`kimi-a\` | src/bin/kimi-a.ts |

${AGENTS_SYNC_BINS_END}

### \`src/lib/\` domains (summary)

${AGENTS_SYNC_LIB_DOMAINS_BEGIN}

| Domain | Representative files |
| ------ | -------------------- |
| **Core** | \`utils.ts\` |

${AGENTS_SYNC_LIB_DOMAINS_END}

## Build, test & quality gates

**There is no build step.** TypeScript is run directly via \`bun run\`.
`;

const SAMPLE_LIB_README = `# lib

## Domains

| Domain | Files | Purpose |
| ------ | ----- | ------- |
| **Core** | \`utils.ts\`, \`version.ts\` | Shared utilities |
| **Sync** | \`desktop-sync.ts\` | Desktop sync |
`;

const SAMPLE_DX = `[[endpoints]]
name = "alpha"
url = "https://example.com/a"

[[endpoints]]
name = "beta"
url = "https://example.com/b"

[finishWork]
gates = ["bun run check:fast", "kimi-doctor --quick"]
`;

const SAMPLE_PACKAGE = {
  name: "demo",
  bin: {
    "kimi-a": "src/bin/kimi-a.ts",
    "kimi-b": "src/bin/kimi-b.ts",
  },
};

describe("agents-md-sync", () => {
  test("readLibDomainRows maps README Domains table", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agents-src-"));
    try {
      await Bun.write(join(dir, "src/lib/README.md"), SAMPLE_LIB_README);
      const rows = await readLibDomainRows(dir);
      expect(rows).toHaveLength(2);
      expect(rows?.[0]?.domain).toBe("**Core**");
      expect(rows?.[0]?.files).toContain("utils.ts");
      expect(rows?.[1]?.domain).toBe("**Sync**");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readDxEndpoints parses dx.config.toml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agents-src-"));
    try {
      await Bun.write(join(dir, "dx.config.toml"), SAMPLE_DX);
      const endpoints = await readDxEndpoints(dir);
      expect(endpoints).toHaveLength(2);
      expect(endpoints?.[0]?.name).toBe("alpha");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("buildBinInventoryBlock sorts bins and wraps markers", () => {
    const block = buildBinInventoryBlock({
      "kimi-z": "src/bin/kimi-z.ts",
      "kimi-a": "src/bin/kimi-a.ts",
    });
    expect(block).toContain(AGENTS_SYNC_BINS_BEGIN);
    expect(block).toContain(AGENTS_SYNC_BINS_END);
    expect(block.indexOf("kimi-a")).toBeLessThan(block.indexOf("kimi-z"));
  });

  test("buildEndpointsBlock renders name/url rows", () => {
    const block = buildEndpointsBlock([{ name: "alpha", url: "https://a.test" }]);
    expect(block).toContain("`alpha`");
    expect(block).toContain("https://a.test");
  });

  test("buildLibDomainsBlock preserves domain formatting", () => {
    const block = buildLibDomainsBlock([{ domain: "**Core**", files: "`utils.ts`" }]);
    expect(block).toContain(AGENTS_SYNC_LIB_DOMAINS_BEGIN);
    expect(block).toContain("**Core**");
  });

  test("patchBinCounts and patchGateNames update prose", () => {
    const md = patchBinCounts("CLI entry points (1 registered bins in `package.json` `bin`)", 3);
    expect(md).toContain("3 registered bins");
    const gates = patchGateNames("Built-in execution gates (`a`)", ["a", "b"]);
    expect(gates).toContain("`a`, `b`");
  });

  test("syncAgentsMd rewrites bins, lib domains, and gate prose", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agents-sync-"));
    try {
      await Bun.write(join(dir, "package.json"), JSON.stringify(SAMPLE_PACKAGE, null, 2));
      await Bun.write(join(dir, "AGENTS.md"), SAMPLE_AGENTS);
      await Bun.write(join(dir, "src/lib/README.md"), SAMPLE_LIB_README);
      await Bun.write(join(dir, "dx.config.toml"), SAMPLE_DX);

      const synced = await syncAgentsMd(dir);
      expect(synced).toBeGreaterThan(0);

      const next = await Bun.file(join(dir, "AGENTS.md")).text();
      expect(next).toContain("`kimi-b`");
      expect(next).toContain("2 registered bins");
      expect(next).toContain("**Sync**");
      expect(next).toContain("Built-in execution gates (`bunfig-policy`");

      const bins = await readPackageBins(dir);
      expect(bins).not.toBeNull();

      const status = await checkAgentsMdSync(dir);
      expect(status?.fresh).toBe(true);
      expect(status?.binCount).toBe(2);
      expect(status?.endpointCount).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("checkAgentsMdSync reports drift when markers missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agents-sync-"));
    try {
      await Bun.write(join(dir, "package.json"), JSON.stringify(SAMPLE_PACKAGE, null, 2));
      await Bun.write(join(dir, "AGENTS.md"), "# No markers\n");
      await Bun.write(join(dir, "dx.config.toml"), SAMPLE_DX);

      const status = await checkAgentsMdSync(dir);
      expect(status?.fresh).toBe(false);
      expect(status?.staleBlocks.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
