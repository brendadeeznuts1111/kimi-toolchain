/**
 * Runtime APIs present in Bun 1.3+ that may lag behind bun-types.
 * Remove entries as @types/bun catches up.
 */
/// <reference types="bun" />

declare module "bun" {
  /** Current working directory. */
  const cwd: string;
  /** Current process ID. */
  const pid: number;

  interface BunFile {
    /** Synchronous read (Bun extension). */
    textSync(encoding?: string): string;
  }
}

interface ReadableStream<R = any> {
  [Symbol.asyncIterator](): AsyncIterator<R>;
}
