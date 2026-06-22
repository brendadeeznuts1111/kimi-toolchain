import { describe, expect, test } from "bun:test";
import { parseSseMessages } from "../src/lib/mcp-probe.ts";

describe("mcp-probe", () => {
  test("parseSseMessages extracts single data payload", () => {
    const text = 'event: message\ndata: {"result":{"tools":[]}}\n\n';
    expect(parseSseMessages(text)).toEqual(['{"result":{"tools":[]}}']);
  });

  test("parseSseMessages joins multi-line data payloads", () => {
    const text = 'data: {"foo":\ndata: "bar"}\n\n';
    expect(parseSseMessages(text)).toEqual(['{"foo":"bar"}']);
  });

  test("parseSseMessages skips [DONE] and comments", () => {
    const text = ':comment\ndata: {"result":1}\ndata: [DONE]\n\n';
    expect(parseSseMessages(text)).toEqual(['{"result":1}']);
  });

  test("parseSseMessages handles CRLF line endings", () => {
    const text = 'event: message\r\ndata: {"ok":true}\r\n\r\n';
    expect(parseSseMessages(text)).toEqual(['{"ok":true}']);
  });

  test("parseSseMessages returns empty array when no data lines", () => {
    expect(parseSseMessages("event: ping\n\n")).toEqual([]);
  });
});
