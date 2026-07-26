import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BufferedWriterOptions {
  batchSize: number;           // 每批最多多少条
  flushIntervalMs: number;     // 定时刷新间隔
  maxQueueSize: number;        // 队列上限
  fallbackThreshold: number;   // 连续失败多少次后降级
  fallbackFilePrefix: string;  // 降级文件前缀
  dataDir?: string;            // 数据目录
}

export abstract class BufferedWriter<T> implements OnModuleInit, OnModuleDestroy {
  protected queue: T[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  protected consecutiveFailures = 0;
  protected fallbackMode = false;
  protected abstract logger: { error: (msg: string, err?: unknown) => void; warn: (msg: string) => void };

  constructor(protected options: BufferedWriterOptions) {}

  // 子类实现：批量写入
  protected abstract batchInsert(entries: T[]): void;
  // 子类实现：单条写入（降级时使用）
  protected abstract insertOne(entry: T): void;
  // 子类实现：序列化为文件行
  protected abstract serializeForFile(entry: T): string;

  onModuleInit() {
    this.flushTimer = setInterval(() => this.flush(), this.options.flushIntervalMs);
    this.flushTimer.unref();
  }

  onModuleDestroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  enqueue(entry: T): { queued: true; queueLength: number } {
    if (this.queue.length >= this.options.maxQueueSize) {
      const dropped = this.queue.splice(0, Math.floor(this.options.maxQueueSize / 10));
      this.logger.warn(`队列已满(${this.options.maxQueueSize})，丢弃 ${dropped.length} 条旧数据`);
    }
    this.queue.push(entry);
    if (this.queue.length >= this.options.batchSize) {
      this.flush();
    }
    return { queued: true, queueLength: this.queue.length };
  }

  protected flush() {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, Math.min(this.options.batchSize, this.queue.length));

    if (this.fallbackMode) {
      this.flushToFile(batch);
      return;
    }

    try {
      this.batchInsert(batch);
      this.consecutiveFailures = 0;
    } catch (err: unknown) {
      this.consecutiveFailures++;
      this.logger.error(`batch insert failed (${this.consecutiveFailures}/${this.options.fallbackThreshold})`, err);

      if (this.consecutiveFailures >= this.options.fallbackThreshold) {
        this.fallbackMode = true;
        this.logger.warn(`连续失败 ${this.options.fallbackThreshold} 次，启用文件降级模式`);
        this.flushToFile(batch);
      } else {
        for (const entry of batch) {
          try {
            this.insertOne(entry);
          } catch (err: unknown) {
            this.logger.error('fallback insert failed', err);
          }
        }
      }
    }
  }

  protected flushToFile(entries: T[]) {
    try {
      const dataDir = this.options.dataDir || process.env.DATA_DIR || path.join(__dirname, '../../../data');
      const logDir = path.join(dataDir, 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      const filePath = path.join(logDir, `${this.options.fallbackFilePrefix}-${new Date().toISOString().slice(0, 10)}.log`);
      const lines = entries.map(e => this.serializeForFile(e));
      fs.appendFileSync(filePath, lines.join('\n') + '\n');
    } catch (err: unknown) {
      this.logger.error('文件降级写入也失败，丢弃数据', err);
    }
  }
}
