import { describe, expect, test } from "bun:test";
import { pickBestWorkspaceId } from "../src/lib/herdr-workspace-match.ts";

describe("herdr-workspace-match", () => {
  test("pickBestWorkspaceId returns sole workspace unchanged", () => {
    expect(pickBestWorkspaceId(["w9"], "", () => 0)).toBe("w9");
  });

  test("pickBestWorkspaceId prefers workspace with more panes", () => {
    const counts: Record<string, number> = { w1: 4, w2: 8, w3: 8 };
    const picked = pickBestWorkspaceId(["w1", "w2", "w3"], "", (id) => counts[id] ?? 0);
    expect(picked).toBe("w2");
  });

  test("pickBestWorkspaceId breaks ties lexicographically regardless of input order", () => {
    const counts: Record<string, number> = { w1: 5, w2: 5 };
    expect(pickBestWorkspaceId(["w2", "w1"], "", (id) => counts[id] ?? 0)).toBe("w1");
    expect(pickBestWorkspaceId(["wB", "wC"], "", (id) => counts[id] ?? 0)).toBe("wB");
  });
});
