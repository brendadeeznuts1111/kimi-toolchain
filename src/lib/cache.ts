/**
 * cache.ts — In-memory TTL cache with stats, eviction hooks, and coalesced compute.
 */

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  lastSetAt?: number;
}

export interface CacheEntryMeta<T> {
  value: T;
  setAt: number;
  expiresAt: number;
  stale: boolean;
}

export interface TtlCacheOptions<T> {
  ttlMs: number;
  onEvict?: (key: string, value: T) => void;
}

interface InternalEntry<T> {
  value: T;
  setAt: number;
  expiresAt: number;
}

/** TTL-backed Map cache with hit/miss stats and optional onEvict callback. */
export class TtlCache<T> {
  private readonly store = new Map<string, InternalEntry<T>>();
  private readonly ttlMs: number;
  private readonly onEvict?: (key: string, value: T) => void;
  private hits = 0;
  private misses = 0;
  private lastSetAt: number | undefined;
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(options: TtlCacheOptions<T>) {
    this.ttlMs = Math.max(1, options.ttlMs);
    this.onEvict = options.onEvict;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.evict(key, entry);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return entry.value;
  }

  /** Return value even when TTL expired (stale-while-revalidate). */
  peek(key: string): CacheEntryMeta<T> | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    const now = Date.now();
    return {
      value: entry.value,
      setAt: entry.setAt,
      expiresAt: entry.expiresAt,
      stale: entry.expiresAt <= now,
    };
  }

  set(key: string, value: T, ttlMs = this.ttlMs): void {
    const now = Date.now();
    const existing = this.store.get(key);
    if (existing) this.onEvict?.(key, existing.value);
    this.store.set(key, { value, setAt: now, expiresAt: now + ttlMs });
    this.lastSetAt = now;
  }

  invalidate(key: string): void {
    const entry = this.store.get(key);
    if (!entry) return;
    this.evict(key, entry);
  }

  invalidateAll(): void {
    for (const [key, entry] of this.store) {
      this.evict(key, entry);
    }
  }

  async getOrCompute(key: string, compute: () => T | Promise<T>): Promise<T> {
    const fresh = this.get(key);
    if (fresh !== undefined) return fresh;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = Promise.resolve(compute())
      .then((value) => {
        this.set(key, value);
        this.inflight.delete(key);
        return value;
      })
      .catch((error: unknown) => {
        this.inflight.delete(key);
        throw error;
      });
    this.inflight.set(key, promise);
    return promise;
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      lastSetAt: this.lastSetAt,
    };
  }

  private evict(key: string, entry: InternalEntry<T>): void {
    this.store.delete(key);
    this.onEvict?.(key, entry.value);
  }
}
