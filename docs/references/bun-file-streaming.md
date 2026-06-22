---
title: "Bun File Streaming"
tags: [references, reference, bun]
category: core
status: draft
priority: medium
---
# Bun File Streaming Reference

Decision rules for Bun-native file streaming in `kimi-toolchain`.

## Source-backed API facts

- Bun documents `Bun.file` and `Bun.write` as the recommended optimized file-system APIs: <https://bun.com/docs/runtime/file-io>.
- `Bun.file(path)` returns a lazy `BunFile`; use `.text()`, `.bytes()`, or `.arrayBuffer()` when the caller needs the whole payload: <https://bun.com/docs/guides/read-file/string>.
- Use `.stream()` to consume a file incrementally as a `ReadableStream`: <https://bun.com/docs/guides/read-file/stream>.
- Streams are for binary data without loading it all into memory at once: <https://bun.com/docs/runtime/streams>.
- To stream a file over HTTP, pass the `BunFile` directly to `new Response(file)`: <https://bun.com/docs/guides/http/stream-file>.
- To write a generic `ReadableStream`, wrap it in `new Response(stream)` before `Bun.write`: <https://bun.com/docs/guides/write-file/stream>.

## Decision matrix

| Need                                             | Use                                                                                       | Avoid                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Small config, taxonomy, manifest, or schema file | `await Bun.file(path).text()` or `await Bun.file(path).json()`                            | Streaming only to immediately concatenate chunks        |
| Binary payload needed in memory                  | `await Bun.file(path).bytes()`                                                            | Node `Buffer` APIs in new async code                    |
| Lazy records from large JSONL files              | `for await (const chunk of Bun.file(path).stream())` plus `Bun.JSONL.parseChunk`          | Loading the full file before parsing                    |
| Copy a large file                                | `await Bun.write(dest, Bun.file(src))` or `await Bun.write(dest, Bun.file(src).stream())` | Manual read-then-write buffers                          |
| Persist a transformed stream                     | `await Bun.write(dest, new Response(stream))`                                             | Collecting transformed output into a giant string       |
| Serve a static artifact                          | `return new Response(Bun.file(path))`                                                     | Reading the file first, then building `Response(bytes)` |
| Read a process or fetch body as text             | `Bun.readableStreamToText(stream)` via `readableStreamToText()`                           | `new Response(stream).text()` open-coded in call sites  |

## Repo patterns

- `src/lib/bun-io.ts` is the transition boundary. New async feature code should prefer `readTextAsync`, `writeTextAsync`, or direct `Bun.file`/`Bun.write` calls when streaming is the point.
- `src/lib/ndjson.ts` is the exemplar for lazy file parsing. It streams chunks, accumulates only incomplete tails, and drains records through `Bun.JSONL.parseChunk`.
- `src/lib/bun-utils.ts` owns stream-to-text convenience helpers. Add new shared Bun runtime helpers there instead of scattering compatibility wrappers.
- `src/lib/cli-contract.ts` is the stdout example: `Bun.write(Bun.stdout, file)` first, with a byte fallback only where Bun versions require it.

## Recommended examples

### Large file copy

```ts
export async function copyLargeFile(src: string, dest: string): Promise<void> {
  await Bun.write(dest, Bun.file(src));
}
```

Use this when the payload is opaque and no transformation is needed. Prefer `Bun.file(src)` directly because `BunFile` already carries the lazy blob interface; reach for `.stream()` when the call site specifically needs stream transforms.

### Streaming transform to disk

```ts
export async function uppercaseLog(src: string, dest: string): Promise<void> {
  const transformed = Bun.file(src)
    .stream()
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, controller) {
          controller.enqueue(chunk.toUpperCase());
        },
      })
    )
    .pipeThrough(new TextEncoderStream());

  await Bun.write(dest, new Response(transformed));
}
```

Keep transform chains short. If the file is small and the logic needs whole-document context, full-load processing is simpler and often faster.

### Lazy JSONL scan

```ts
for await (const { value, index } of streamNdjsonRecords(path)) {
  if (index > 1_000) break;
  consume(value);
}
```

This is the existing pattern in `src/lib/ndjson.ts`; use it for ledgers and long-running logs where bounded memory matters.

### Artifact HTTP response

```ts
function artifactResponse(path: string, contentType: string): Response {
  return new Response(Bun.file(path), {
    headers: { "Content-Type": contentType },
  });
}
```

Do this at HTTP route boundaries. Keep artifact indexing and permission checks outside the streaming body construction so failures happen before bytes start flowing.

## Performance guidance

- Prefer full loads for small files that need whole-content parsing.
- Prefer streaming for large files, long-running logs, ledgers, generated reports, and opaque artifact transfer.
- Avoid extra `TransformStream` layers in hot paths; every layer adds scheduling and allocation overhead.
- Avoid copying stream chunks unless a parser requires carry-over buffers. When carry-over is needed, retain only the incomplete tail.
- Benchmark claims should use `Bun.nanoseconds()` and should state file size, filesystem, Bun version, and transform count.

## Verification

For docs-only changes to this guidance, run:

```bash
bun run format:check
bun run lint:links
```

For helper or parser changes, add the targeted unit test first, then run:

```bash
bun test test/ndjson.unit.test.ts
bun run check:fast
```
## Related

- [INDEX.md](../INDEX.md) — Documentation index
