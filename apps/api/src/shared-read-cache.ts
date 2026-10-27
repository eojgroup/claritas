type CachedRead = { value: unknown; expiresAt: number; bytes: number };

/**
 * Short-lived cache for shared source data, called only after request auth.
 * Coalesces simultaneous reads without caching failures or retaining unlimited
 * filter combinations / large news payloads. Never use for account data.
 */
export class SharedReadCache {
  private readonly values = new Map<string, CachedRead>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private bytes = 0;

  constructor(private readonly options: {
    ttlMs: number;
    maxEntries: number;
    maxBytes: number;
    now?: () => number;
  }) {}

  private now() { return (this.options.now ?? Date.now)(); }

  private remove(key: string) {
    const entry = this.values.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.values.delete(key);
  }

  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.values.delete(key);
      this.values.set(key, cached);
      return cached.value as T;
    }
    this.remove(key);
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;

    // Do not retain an unbounded number of in-flight filter combinations.
    // These uncached requests still use the normal database timeout/limits.
    if (this.pending.size >= this.options.maxEntries) return load();
    const result = Promise.resolve().then(load).then((value) => {
      let serialized: string | undefined;
      try { serialized = JSON.stringify(value); } catch { return value; }
      if (serialized === undefined) return value;
      const bytes = Buffer.byteLength(key) + Buffer.byteLength(serialized);
      if (bytes > this.options.maxBytes) return value;
      const now = this.now();
      for (const [storedKey, entry] of this.values) {
        if (entry.expiresAt <= now) this.remove(storedKey);
      }
      while (this.values.size >= this.options.maxEntries || this.bytes + bytes > this.options.maxBytes) {
        this.remove(this.values.keys().next().value!);
      }
      this.values.set(key, { value, bytes, expiresAt: now + this.options.ttlMs });
      this.bytes += bytes;
      return value;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, result);
    return result;
  }
}
