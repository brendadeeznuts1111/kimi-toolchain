import { describe, expect, test, afterEach } from "bun:test";
import {
  benchFileServeFull,
  benchFileServeRange,
  getFileBenchServer,
  stopFileBenchServers,
} from "../file-bench.ts";

describe("file-bench", () => {
  afterEach(() => {
    stopFileBenchServers();
  });

  test("serves full payload via Bun.file streaming", async () => {
    const server = await getFileBenchServer();
    await expect(benchFileServeFull(server)).resolves.toBeUndefined();
  });

  test("serves partial content with Range (206)", async () => {
    const server = await getFileBenchServer();
    await expect(benchFileServeRange(server)).resolves.toBeUndefined();
  });
});