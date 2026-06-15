/**
 * Runtime APIs present in Bun 1.3+ that may lag behind bun-types.
 * Remove entries as @types/bun catches up.
 */
/// <reference types="bun" />

declare module "bun" {
  const cwd: string;
  const pid: number;

  interface BunFile {
    textSync(encoding?: string): string;
  }
}

interface ReadableStream<R = any> {
  [Symbol.asyncIterator](): AsyncIterator<R>;
}
