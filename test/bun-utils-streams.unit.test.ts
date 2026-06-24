import { describe, expect, test } from "bun:test";
import {
  readableStreamToArray,
  readableStreamToArrayBuffer,
  readableStreamToBlob,
  readableStreamToBytes,
  readableStreamToJson,
  readableStreamToText,
} from "../src/lib/bun-utils.ts";

function makeStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe("bun-utils-streams", () => {
  test("readableStreamToText reads UTF-8 chunks", async () => {
    const encoder = new TextEncoder();
    const stream = makeStream([encoder.encode("hello "), encoder.encode("world")]);
    expect(await readableStreamToText(stream)).toBe("hello world");
  });

  test("readableStreamToText returns empty string for null/undefined stream", async () => {
    expect(await readableStreamToText(null)).toBe("");
    expect(await readableStreamToText(undefined)).toBe("");
  });

  test("readableStreamToBytes concatenates chunks", async () => {
    const encoder = new TextEncoder();
    const stream = makeStream([encoder.encode("foo"), encoder.encode("bar")]);
    const bytes = await readableStreamToBytes(stream);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe("foobar");
  });

  test("readableStreamToArrayBuffer returns an ArrayBuffer", async () => {
    const encoder = new TextEncoder();
    const stream = makeStream([encoder.encode("ab"), encoder.encode("cd")]);
    const buffer = await readableStreamToArrayBuffer(stream);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(buffer)).toBe("abcd");
  });

  test("readableStreamToBlob returns a Blob", async () => {
    const encoder = new TextEncoder();
    const stream = makeStream([encoder.encode("x"), encoder.encode("y")]);
    const blob = await readableStreamToBlob(stream);
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe("xy");
  });

  test("readableStreamToJson parses JSON stream", async () => {
    const encoder = new TextEncoder();
    const stream = makeStream([encoder.encode('{"a":1,"b":['), encoder.encode("2,3]}")]);
    expect(await readableStreamToJson<{ a: number; b: number[] }>(stream)).toEqual({
      a: 1,
      b: [2, 3],
    });
  });

  test("readableStreamToArray collects typed chunks", async () => {
    const stream = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.close();
      },
    });
    expect(await readableStreamToArray(stream)).toEqual([1, 2]);
  });
});
