import { describe, expect, test } from "bun:test";
import {
  HerdrSessionError,
  requireSessionRunning,
  type ListHerdrSessions,
} from "../src/lib/herdr-session-preflight.ts";

function mockList(sessions: Array<{ name: string; running: boolean }>): ListHerdrSessions {
  return () => ({ ok: true, sessions });
}

describe("herdr-session-preflight", () => {
  test("requireSessionRunning passes for running session", async () => {
    await expect(
      requireSessionRunning("dev", mockList([{ name: "dev", running: true }]))
    ).resolves.toBeUndefined();
  });

  test("requireSessionRunning throws missing for absent session", async () => {
    await expect(
      requireSessionRunning("dev", mockList([{ name: "default", running: true }]))
    ).rejects.toThrow(HerdrSessionError);
    await expect(
      requireSessionRunning("dev", mockList([{ name: "default", running: true }]))
    ).rejects.toThrow(/missing/);
  });

  test("requireSessionRunning throws stopped for down session", async () => {
    await expect(
      requireSessionRunning("dev", mockList([{ name: "dev", running: false }]))
    ).rejects.toThrow(HerdrSessionError);
    await expect(
      requireSessionRunning("dev", mockList([{ name: "dev", running: false }]))
    ).rejects.toThrow(/stopped/);
  });

  test("requireSessionRunning treats empty session as default", async () => {
    await expect(
      requireSessionRunning("", mockList([{ name: "default", running: true }]))
    ).resolves.toBeUndefined();
  });
});
