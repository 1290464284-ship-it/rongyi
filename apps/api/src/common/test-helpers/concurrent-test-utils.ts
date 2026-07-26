import * as crypto from 'node:crypto';

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runConcurrently<T>(
  tasks: (() => Promise<T>)[],
  concurrency?: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  const effectiveConcurrency = concurrency ?? tasks.length;

  if (effectiveConcurrency >= tasks.length) {
    return Promise.all(tasks.map((task) => task()));
  }

  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < tasks.length) {
      const index = currentIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(effectiveConcurrency, tasks.length) },
    () => worker(),
  );

  await Promise.all(workers);
  return results;
}

export async function withRaceCondition(
  fn: () => Promise<unknown>,
  iterations = 10,
): Promise<void> {
  const tasks = Array.from({ length: iterations }, () => fn);
  await runConcurrently(tasks);
}

export async function measureExecutionTime<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  const durationMs = Date.now() - start;
  return { result, durationMs };
}

export function microtaskDelay(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === 'function') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export function jitterDelay(baseMs: number, jitterMs = 0): Promise<void> {
  const buffer = crypto.randomBytes(4);
  const randomValue = buffer.readUInt32BE(0) / 0xFFFFFFFF;
  const actualDelay = baseMs + (randomValue * 2 - 1) * jitterMs;
  return delay(Math.max(0, actualDelay));
}

export interface ConcurrentTestResult<T> {
  results: T[];
  errors: Error[];
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
}

export async function runConcurrentTest<T>(
  taskCount: number,
  taskFactory: (index: number) => Promise<T>,
  concurrency?: number,
): Promise<ConcurrentTestResult<T>> {
  const results: T[] = [];
  const errors: Error[] = [];

  const tasks = Array.from({ length: taskCount }, (_, i) => async () => {
    try {
      const result = await taskFactory(i);
      results.push(result);
      return result;
    } catch (err) {
      errors.push(err as Error);
      throw err;
    }
  });

  const start = Date.now();

  try {
    await runConcurrently(tasks, concurrency);
  } catch {
    // Ignored - errors are already collected
  }

  const totalDurationMs = Date.now() - start;

  return {
    results,
    errors,
    successCount: results.length,
    failureCount: errors.length,
    totalDurationMs,
  };
}

export function expectNoDuplicates<T>(items: T[], key?: keyof T): void {
  if (key) {
    const values = items.map((item) => item[key]);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  } else {
    const uniqueItems = new Set(items);
    expect(uniqueItems.size).toBe(items.length);
  }
}

export function sumNumbers(numbers: number[]): number {
  return numbers.reduce((sum, n) => sum + n, 0);
}
