/** Minimal fetch surface for tests without DOM lib or undici-types in tsconfig. */
declare global {
  interface Response {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly body: ReadableStream<Uint8Array> | null;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob>;
    json(): Promise<any>;
    text(): Promise<string>;
    readonly headers: Headers;
  }

  interface Headers {
    get(name: string): string | null;
    set(name: string, value: string): void;
    has(name: string): boolean;
    getSetCookie(): string[];
    entries(): IterableIterator<[string, string]>;
  }

  interface Request {
    readonly url: string;
    readonly method: string;
    text(): Promise<string>;
  }
}

declare module "bun" {
  namespace __internal {
    interface BunHeadersOverride {
      get(name: string): string | null;
      set(name: string, value: string): void;
      has(name: string): boolean;
      getSetCookie(): string[];
      entries(): IterableIterator<[string, string]>;
    }
  }
}

export {};
