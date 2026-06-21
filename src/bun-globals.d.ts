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

/** Bun fetch() extensions beyond standard RequestInit. */
interface BunFetchRequestInit extends RequestInit {
  keepalive?: boolean;
  tls?: { minVersion?: number };
  proxy?: string | { url: string; headers?: Record<string, string> };
  unix?: string;
  decompress?: boolean;
  verbose?: boolean | "curl";
}
