export interface RateLimitData {
  count: number;
  resetTime: number;
}

export interface RateLimitStore {
  get(key: string): Promise<RateLimitData | null>;
  set(key: string, count: number, resetTime: number): Promise<void>;
  increment(key: string, windowMs: number): Promise<RateLimitData>;
}
