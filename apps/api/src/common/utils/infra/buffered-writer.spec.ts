/* eslint-disable security/detect-non-literal-fs-filename -- 测试文件使用临时目录路径 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BufferedWriter } from './buffered-writer';

class TestBufferedWriter extends BufferedWriter<string> {
  public batchInsertCalls: string[][] = [];
  public insertOneCalls: string[] = [];
  public shouldBatchFail = false;
  public shouldSingleFail = false;
  protected logger = {
    error: jest.fn(),
    warn: jest.fn(),
  };

  constructor(options: Partial<ConstructorParameters<typeof BufferedWriter<string>>[0]> = {}) {
    super({
      batchSize: 3,
      flushIntervalMs: 10000,
      maxQueueSize: 10,
      fallbackThreshold: 2,
      fallbackFilePrefix: 'test-buffered',
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'buffered-writer-test-')),
      ...options,
    });
  }

  protected batchInsert(entries: string[]): void {
    this.batchInsertCalls.push([...entries]);
    if (this.shouldBatchFail) {
      throw new Error('batch insert failed');
    }
  }

  protected insertOne(entry: string): void {
    this.insertOneCalls.push(entry);
    if (this.shouldSingleFail) {
      throw new Error('single insert failed');
    }
  }

  protected serializeForFile(entry: string): string {
    return `SERIALIZED:${entry}`;
  }

  getQueue(): string[] {
    return this.queue;
  }

  getFallbackMode(): boolean {
    return this.fallbackMode;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  flushPublic(): void {
    this.flush();
  }

  cleanup(): void {
    try {
      fs.rmSync(this.options.dataDir!, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
}

describe('BufferedWriter 缓冲写入器', () => {
  let writer: TestBufferedWriter;

  afterEach(() => {
    if (writer) {
      writer.cleanup();
    }
  });

  describe('enqueue 入队', () => {
    beforeEach(() => {
      writer = new TestBufferedWriter();
    });

    it('入队应返回 queued=true 和当前队列长度', () => {
      const result = writer.enqueue('item1');
      expect(result.queued).toBe(true);
      expect(result.queueLength).toBe(1);
    });

    it('入队数据应保存在队列中', () => {
      writer.enqueue('a');
      writer.enqueue('b');
      expect(writer.getQueue()).toEqual(['a', 'b']);
    });

    it('达到 batchSize 时应自动 flush', () => {
      writer.enqueue('a');
      writer.enqueue('b');
      writer.enqueue('c');
      expect(writer.getQueue().length).toBe(0);
      expect(writer.batchInsertCalls.length).toBe(1);
      expect(writer.batchInsertCalls[0]).toEqual(['a', 'b', 'c']);
    });

    it('队列超过 maxQueueSize 时应丢弃旧数据', () => {
      writer = new TestBufferedWriter({ maxQueueSize: 20, batchSize: 100 });
      for (let i = 0; i < 20; i++) {
        writer.enqueue(`item${i}`);
      }
      expect(writer.getQueue().length).toBe(20);
      writer.enqueue('item20');
      expect(writer.getQueue().length).toBeLessThan(21);
    });
  });

  describe('flush 刷新', () => {
    beforeEach(() => {
      writer = new TestBufferedWriter();
    });

    it('空队列 flush 不应调用 batchInsert', () => {
      writer.flushPublic();
      expect(writer.batchInsertCalls.length).toBe(0);
    });

    it('flush 应调用 batchInsert 并清空队列', () => {
      writer.enqueue('a');
      writer.enqueue('b');
      writer.flushPublic();
      expect(writer.getQueue().length).toBe(0);
      expect(writer.batchInsertCalls.length).toBe(1);
      expect(writer.batchInsertCalls[0]).toEqual(['a', 'b']);
    });

    it('批量失败次数未达阈值时应降级为单条插入', () => {
      writer.shouldBatchFail = true;
      writer.shouldSingleFail = false;
      writer.enqueue('a');
      writer.enqueue('b');
      writer.enqueue('c');
      expect(writer.getConsecutiveFailures()).toBe(1);
      expect(writer.insertOneCalls.length).toBe(3);
      expect(writer.getFallbackMode()).toBe(false);
    });

    it('批量失败达到阈值应进入降级模式', () => {
      writer.shouldBatchFail = true;
      writer.shouldSingleFail = true;
      writer.enqueue('a');
      writer.enqueue('b');
      writer.enqueue('c');
      expect(writer.getConsecutiveFailures()).toBe(1);
      writer.enqueue('d');
      writer.enqueue('e');
      writer.enqueue('f');
      expect(writer.getConsecutiveFailures()).toBe(2);
      expect(writer.getFallbackMode()).toBe(true);
    });
  });

  describe('降级模式', () => {
    beforeEach(() => {
      writer = new TestBufferedWriter({ fallbackThreshold: 1 });
    });

    it('降级模式下应写入文件', () => {
      writer.shouldBatchFail = true;
      writer.shouldSingleFail = true;
      writer.enqueue('a');
      writer.enqueue('b');
      writer.enqueue('c');
      expect(writer.getFallbackMode()).toBe(true);
      const logDir = path.join(writer['options'].dataDir!, 'logs');
      const files = fs.readdirSync(logDir);
      expect(files.length).toBeGreaterThan(0);
      const logFile = path.join(logDir, files[0]);
      const content = fs.readFileSync(logFile, 'utf8');
      expect(content).toContain('SERIALIZED:a');
      expect(content).toContain('SERIALIZED:b');
      expect(content).toContain('SERIALIZED:c');
    });
  });

  describe('onModuleInit / onModuleDestroy', () => {
    it('onModuleDestroy 应 flush 剩余数据', () => {
      writer = new TestBufferedWriter();
      writer.enqueue('x');
      writer.enqueue('y');
      writer.onModuleDestroy();
      expect(writer.batchInsertCalls.length).toBe(1);
      expect(writer.batchInsertCalls[0]).toEqual(['x', 'y']);
    });
  });
});
