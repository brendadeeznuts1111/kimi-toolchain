import { describe, expect, it } from "bun:test";

// ── Pure resolution logic (testable without mocking Bun) ───────────

interface ToolEntry {
  bin: string;
  path: string | null;
  resolution: "toolchain" | "project" | "system";
  flags: string;
}

type WhichFn = (name: string, opts?: { PATH?: string }) => string | null;

function resolveTools(which: WhichFn, toolchainBin: string): { tools: ToolEntry[]; shadowWarnings: string[] } {
  const resolveToolchain = (name: string) => which(name, { PATH: toolchainBin });
  const resolveDefault = (name: string) => which(name);

  const tools: ToolEntry[] = [
    { bin: "bun", path: resolveDefault("bun"), resolution: "system", flags: "--version" },
    { bin: "kimi-fix", path: resolveToolchain("kimi-fix"), resolution: "toolchain", flags: "--profile" },
    { bin: "kimi-doctor", path: resolveToolchain("kimi-doctor"), resolution: "toolchain", flags: "--effect-gates" },
    { bin: "oxlint", path: resolveDefault("oxlint"), resolution: "project", flags: "--deny-warnings" },
    { bin: "git", path: resolveDefault("git"), resolution: "system", flags: "rev-parse" },
  ];

  const shadowWarnings: string[] = [];
  for (const t of tools) {
    if (t.resolution === "toolchain" && t.path) {
      const sysPath = which(t.bin);
      if (sysPath && sysPath !== t.path) shadowWarnings.push(t.bin);
    }
  }

  return { tools, shadowWarnings };
}

// ── Fake which for tests ───────────────────────────────────────────

function fakeWhich(name: string, opts?: { PATH?: string }): string | null {
  if (opts?.PATH?.includes(".kimi-code")) {
    return `/home/user/.kimi-code/bin/${name}`;
  }
  if (name === "bun") return "/usr/bin/bun";
  if (name === "git") return "/usr/bin/git";
  return null;
}

function shadowWhich(name: string, opts?: { PATH?: string }): string | null {
  // Toolchain PATH has it, but system PATH also has it → shadow
  if (opts?.PATH?.includes(".kimi-code")) {
    return `/home/user/.kimi-code/bin/${name}`;
  }
  // System PATH also resolves it → different path = shadow
  if (name === "kimi-fix") return "/usr/local/bin/kimi-fix";
  if (name === "bun") return "/usr/bin/bun";
  if (name === "git") return "/usr/bin/git";
  return null;
}

function emptyWhich(_name: string, _opts?: { PATH?: string }): string | null {
  return null;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("toolchain-paths", () => {
  it("resolves system bins via default PATH", () => {
    const { tools } = resolveTools(fakeWhich, "/home/user/.kimi-code/bin");
    const bun = tools.find((t) => t.bin === "bun")!;
    expect(bun.path).toBe("/usr/bin/bun");
    expect(bun.resolution).toBe("system");
  });

  it("resolves toolchain bins via restricted PATH", () => {
    const { tools } = resolveTools(fakeWhich, "/home/user/.kimi-code/bin");
    const kimiFix = tools.find((t) => t.bin === "kimi-fix")!;
    expect(kimiFix.path).toBe("/home/user/.kimi-code/bin/kimi-fix");
    expect(kimiFix.resolution).toBe("toolchain");
  });

  it("returns null for missing toolchain bins", () => {
    const { tools } = resolveTools(emptyWhich, "/nonexistent/bin");
    const kimiFix = tools.find((t) => t.bin === "kimi-fix")!;
    expect(kimiFix.path).toBeNull();
  });

  it("returns null for missing project bins", () => {
    const { tools } = resolveTools(emptyWhich, "/tmp/tc");
    const oxlint = tools.find((t) => t.bin === "oxlint")!;
    expect(oxlint.path).toBeNull();
    expect(oxlint.resolution).toBe("project");
  });

  it("detects no shadows when toolchain is the only source", () => {
    const { shadowWarnings } = resolveTools(fakeWhich, "/home/user/.kimi-code/bin");
    expect(shadowWarnings).toEqual([]);
  });

  it("detects shadows when bin exists in both toolchain and system PATH", () => {
    const { shadowWarnings } = resolveTools(shadowWhich, "/home/user/.kimi-code/bin");
    expect(shadowWarnings).toContain("kimi-fix");
  });

  it("does not detect shadows for non-toolchain bins", () => {
    const { shadowWarnings } = resolveTools(shadowWhich, "/home/user/.kimi-code/bin");
    expect(shadowWarnings).not.toContain("bun");
    expect(shadowWarnings).not.toContain("git");
  });

  it("all toolchain bins have resolution 'toolchain'", () => {
    const { tools } = resolveTools(fakeWhich, "/home/user/.kimi-code/bin");
    const tcBins = tools.filter((t) => t.bin.startsWith("kimi-"));
    expect(tcBins.length).toBe(2);
    for (const t of tcBins) {
      expect(t.resolution).toBe("toolchain");
    }
  });

  it("all project bins have resolution 'project'", () => {
    const { tools } = resolveTools(fakeWhich, "/home/user/.kimi-code/bin");
    const prjBins = tools.filter((t) => t.bin === "oxlint");
    expect(prjBins.length).toBe(1);
    for (const t of prjBins) {
      expect(t.resolution).toBe("project");
    }
  });

  it("flags are non-empty for all tools", () => {
    const { tools } = resolveTools(fakeWhich, "/home/user/.kimi-code/bin");
    for (const t of tools) {
      expect(t.flags.length).toBeGreaterThan(0);
    }
  });
});
