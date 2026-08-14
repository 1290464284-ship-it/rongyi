/** Small bounded TTL cache shared by read-only aggregate services. */
export class TtlCache {
  private readonly entries = new Map<string, { at: number; data: unknown }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
  ) {}

  get<T>(key: string, compute: () => T): T {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.data as T;
    const data = compute();
    this.entries.set(key, { at: now, data });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      /* v8 ignore next -- a new entry is always present when size exceeds maxEntries. */
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return data;
  }
}
