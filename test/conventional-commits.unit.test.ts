import { describe, expect, test } from "bun:test";
import { parseCommit, determineBump, bumpVersion } from "../src/lib/conventional-commits.ts";

describe("parseCommit", () => {
  test("parses feat(scope): message", () => {
    const result = parseCommit("abc123", "feat(auth): add login", "");
    expect(result).toEqual({
      hash: "abc123",
      subject: "feat(auth): add login",
      body: "",
      type: "feat",
      scope: "auth",
      breaking: false,
    });
  });

  test("parses fix: message without scope", () => {
    const result = parseCommit("def456", "fix: resolve null pointer", "");
    expect(result).toEqual({
      hash: "def456",
      subject: "fix: resolve null pointer",
      body: "",
      type: "fix",
      scope: undefined,
      breaking: false,
    });
  });

  test("parses feat!: subject with bang (breaking only via body in current impl)", () => {
    const result = parseCommit("ghi789", "feat!: drop node 14 support", "");
    expect(result).toEqual({
      hash: "ghi789",
      subject: "feat!: drop node 14 support",
      body: "",
      type: "feat",
      scope: undefined,
      breaking: false,
    });
  });

  test("parses feat(scope)!: subject with scope and bang (breaking only via body in current impl)", () => {
    const result = parseCommit("jkl012", "feat(api)!: remove deprecated endpoint", "");
    expect(result).toEqual({
      hash: "jkl012",
      subject: "feat(api)!: remove deprecated endpoint",
      body: "",
      type: "feat",
      scope: "api",
      breaking: false,
    });
  });

  test("detects breaking change from body marker", () => {
    const result = parseCommit(
      "mno345",
      "feat: update config format",
      "BREAKING CHANGE: old config no longer supported"
    );
    expect(result).toEqual({
      hash: "mno345",
      subject: "feat: update config format",
      body: "BREAKING CHANGE: old config no longer supported",
      type: "feat",
      scope: undefined,
      breaking: true,
    });
  });

  test("parses chore(scope): message", () => {
    const result = parseCommit("pqr678", "chore(deps): bump lodash", "");
    expect(result).toEqual({
      hash: "pqr678",
      subject: "chore(deps): bump lodash",
      body: "",
      type: "chore",
      scope: "deps",
      breaking: false,
    });
  });

  test("parses docs: message", () => {
    const result = parseCommit("stu901", "docs: update README", "");
    expect(result).toEqual({
      hash: "stu901",
      subject: "docs: update README",
      body: "",
      type: "docs",
      scope: undefined,
      breaking: false,
    });
  });

  test("parses refactor(ui): message", () => {
    const result = parseCommit("vwx234", "refactor(ui): simplify component", "");
    expect(result).toEqual({
      hash: "vwx234",
      subject: "refactor(ui): simplify component",
      body: "",
      type: "refactor",
      scope: "ui",
      breaking: false,
    });
  });

  test("parses test: message", () => {
    const result = parseCommit("yza567", "test: add unit tests", "");
    expect(result).toEqual({
      hash: "yza567",
      subject: "test: add unit tests",
      body: "",
      type: "test",
      scope: undefined,
      breaking: false,
    });
  });

  test("parses ci: message", () => {
    const result = parseCommit("bcd890", "ci: update workflow", "");
    expect(result).toEqual({
      hash: "bcd890",
      subject: "ci: update workflow",
      body: "",
      type: "ci",
      scope: undefined,
      breaking: false,
    });
  });

  test("parses build: message", () => {
    const result = parseCommit("efg123", "build: configure bundler", "");
    expect(result).toEqual({
      hash: "efg123",
      subject: "build: configure bundler",
      body: "",
      type: "build",
      scope: undefined,
      breaking: false,
    });
  });

  test("parses perf: message", () => {
    const result = parseCommit("hij456", "perf: optimize loop", "");
    expect(result).toEqual({
      hash: "hij456",
      subject: "perf: optimize loop",
      body: "",
      type: "perf",
      scope: undefined,
      breaking: false,
    });
  });

  test("parses style: message", () => {
    const result = parseCommit("klm789", "style: fix formatting", "");
    expect(result).toEqual({
      hash: "klm789",
      subject: "style: fix formatting",
      body: "",
      type: "style",
      scope: undefined,
      breaking: false,
    });
  });

  test("returns null for non-conventional commit", () => {
    const result = parseCommit("nop012", "random message without prefix", "");
    expect(result).toBeNull();
  });

  test("returns null for empty subject", () => {
    const result = parseCommit("qrs345", "", "");
    expect(result).toBeNull();
  });

  test("lowercases type", () => {
    const result = parseCommit("tuv678", "FEAT(auth): add login", "");
    expect(result?.type).toBe("feat");
  });

  test("handles empty body", () => {
    const result = parseCommit("wxy901", "fix: bug", "");
    expect(result?.body).toBe("");
  });

  test("handles multi-line body with BREAKING CHANGE", () => {
    const body = "Some details here\n\nBREAKING CHANGE: behavior changed";
    const result = parseCommit("zab234", "feat: new behavior", body);
    expect(result?.breaking).toBe(true);
  });

  test("subject with bang but body without marker is not breaking", () => {
    const result = parseCommit("cde567", "fix!: urgent fix", "details without breaking keyword");
    expect(result?.breaking).toBe(false);
  });
});

describe("determineBump", () => {
  test("returns major for breaking change", () => {
    const commits = [
      {
        hash: "a",
        subject: "feat!: break",
        body: "",
        type: "feat",
        scope: undefined,
        breaking: true,
      },
    ];
    expect(determineBump(commits)).toBe("major");
  });

  test("returns major when any commit is breaking", () => {
    const commits = [
      { hash: "a", subject: "fix: bug", body: "", type: "fix", scope: undefined, breaking: false },
      {
        hash: "b",
        subject: "feat!: break",
        body: "",
        type: "feat",
        scope: undefined,
        breaking: true,
      },
    ];
    expect(determineBump(commits)).toBe("major");
  });

  test("returns minor for feat without breaking", () => {
    const commits = [
      {
        hash: "a",
        subject: "feat: new",
        body: "",
        type: "feat",
        scope: undefined,
        breaking: false,
      },
    ];
    expect(determineBump(commits)).toBe("minor");
  });

  test("returns minor when feat and fix present", () => {
    const commits = [
      { hash: "a", subject: "fix: bug", body: "", type: "fix", scope: undefined, breaking: false },
      {
        hash: "b",
        subject: "feat: new",
        body: "",
        type: "feat",
        scope: undefined,
        breaking: false,
      },
    ];
    expect(determineBump(commits)).toBe("minor");
  });

  test("returns patch for only fix", () => {
    const commits = [
      { hash: "a", subject: "fix: bug", body: "", type: "fix", scope: undefined, breaking: false },
    ];
    expect(determineBump(commits)).toBe("patch");
  });

  test("returns patch for multiple fixes", () => {
    const commits = [
      { hash: "a", subject: "fix: bug1", body: "", type: "fix", scope: undefined, breaking: false },
      { hash: "b", subject: "fix: bug2", body: "", type: "fix", scope: undefined, breaking: false },
    ];
    expect(determineBump(commits)).toBe("patch");
  });

  test("returns none for empty commits", () => {
    expect(determineBump([])).toBe("none");
  });

  test("returns none for non-feat/fix commits without breaking", () => {
    const commits = [
      {
        hash: "a",
        subject: "chore: cleanup",
        body: "",
        type: "chore",
        scope: undefined,
        breaking: false,
      },
      {
        hash: "b",
        subject: "docs: update",
        body: "",
        type: "docs",
        scope: undefined,
        breaking: false,
      },
    ];
    expect(determineBump(commits)).toBe("none");
  });

  test("breaking takes precedence over feat", () => {
    const commits = [
      {
        hash: "a",
        subject: "feat: new",
        body: "",
        type: "feat",
        scope: undefined,
        breaking: false,
      },
      {
        hash: "b",
        subject: "fix!: break",
        body: "",
        type: "fix",
        scope: undefined,
        breaking: true,
      },
    ];
    expect(determineBump(commits)).toBe("major");
  });

  test("feat takes precedence over fix", () => {
    const commits = [
      { hash: "a", subject: "fix: bug", body: "", type: "fix", scope: undefined, breaking: false },
      {
        hash: "b",
        subject: "feat: new",
        body: "",
        type: "feat",
        scope: undefined,
        breaking: false,
      },
    ];
    expect(determineBump(commits)).toBe("minor");
  });
});

describe("bumpVersion", () => {
  test("bumps major version", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  test("bumps minor version", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });

  test("bumps patch version", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });

  test("handles v-prefixed version", () => {
    expect(bumpVersion("v1.2.3", "major")).toBe("2.0.0");
  });

  test("handles zero major version", () => {
    expect(bumpVersion("0.1.0", "minor")).toBe("0.2.0");
  });

  test("handles large version numbers", () => {
    expect(bumpVersion("99.99.99", "patch")).toBe("99.99.100");
  });

  test("resets minor and patch on major bump", () => {
    expect(bumpVersion("2.5.7", "major")).toBe("3.0.0");
  });

  test("resets patch on minor bump", () => {
    expect(bumpVersion("2.5.7", "minor")).toBe("2.6.0");
  });
});
