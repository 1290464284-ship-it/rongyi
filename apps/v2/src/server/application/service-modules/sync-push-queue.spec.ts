import { describe, expect, it } from 'vitest';
import { sharedDbWriteQueue } from './serial-queue';

describe('sharedDbWriteQueue', () => {
  it('serializes calls coming from different entry points on the same db', async () => {
    const db = {} as object;
    const queueA = sharedDbWriteQueue(db);
    const queueB = sharedDbWriteQueue(db);
    let active = 0;
    let maxActive = 0;
    const task = async (label: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return label;
    };
    const results = await Promise.all([
      queueA(() => task('a')),
      queueB(() => task('b')),
      queueA(() => task('c')),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1);
  });

  it('serializes calls and keeps the queue usable after a rejected task', async () => {
    const db = {} as object;
    const queue = sharedDbWriteQueue(db);
    let calls = 0;
    const first = queue(async () => {
      calls += 1;
      throw new Error('first task failed');
    });
    const second = queue(async () => {
      calls += 1;
      return 'second-ok';
    });
    await expect(first).rejects.toThrow('first task failed');
    await expect(second).resolves.toBe('second-ok');
    expect(calls).toBe(2);
  });
});
