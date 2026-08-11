type SerializedRun = <TResult>(fn: () => Promise<TResult>) => Promise<TResult>;

/**
 * 按 Database 实例共享的写串行队列：sync push / resolveConflict / bulk import
 * 都在显式 BEGIN 内包含 async repository 调用，await 会让出微任务，跨路径并发
 * 仍会嵌套 BEGIN。共享同一个 per-DB 队列后，同一连接上的这类写操作整体串行化。
 */
const sharedDbQueues = new WeakMap<object, SerializedRun>();
const activeWriters = new WeakMap<object, number>();

export function isDbWriteActive(db: object): boolean {
  return (activeWriters.get(db) ?? 0) > 0;
}

export function sharedDbWriteQueue(db: object): SerializedRun {
  const existing = sharedDbQueues.get(db);
  if (existing) return existing;
  let queue: Promise<unknown> = Promise.resolve();
  const run: SerializedRun = (fn) => {
    const executeWithActive = async () => {
      activeWriters.set(db, (activeWriters.get(db) ?? 0) + 1);
      try {
        return await fn();
      } finally {
        const next = (activeWriters.get(db) ?? 1) - 1;
        if (next <= 0) activeWriters.delete(db);
        else activeWriters.set(db, next);
      }
    };
    const result = queue.then(executeWithActive, executeWithActive) as unknown as Promise<Awaited<ReturnType<typeof fn>>>;
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  sharedDbQueues.set(db, run);
  return run;
}
