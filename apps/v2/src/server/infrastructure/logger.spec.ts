import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger, MAX_SERIALIZE_DEPTH, serializeValue } from './logger';

describe('logger serializeValue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('expands an Error into message, stack and cause instead of {}', () => {
    const cause = new Error('root cause');
    const error = new Error('boom', { cause });

    const serialized = serializeValue(error) as Record<string, unknown>;
    expect(serialized.message).toBe('boom');
    expect(typeof serialized.stack).toBe('string');
    expect(serialized.cause).toMatchObject({ message: 'root cause' });
    expect(JSON.stringify(error)).toBe('{}');
    expect(JSON.stringify(serialized)).toContain('"message":"boom"');
    expect(JSON.stringify(serialized)).toContain('"cause"');
  });

  it('recurses through nested cause chains', () => {
    const error = new Error('outer', {
      cause: new Error('middle', { cause: new Error('inner') }),
    });

    const serialized = serializeValue(error) as Record<string, unknown>;
    const middle = serialized.cause as Record<string, unknown>;
    const inner = middle.cause as Record<string, unknown>;
    expect(middle.message).toBe('middle');
    expect(inner.message).toBe('inner');
  });

  it('serializes errors nested in arrays and plain objects', () => {
    const serialized = serializeValue({
      errors: [new Error('first'), new Error('second')],
      meta: { detail: new Error('nested') },
    }) as Record<string, unknown>;

    expect(serialized.errors).toEqual([
      { message: 'first', stack: expect.any(String) },
      { message: 'second', stack: expect.any(String) },
    ]);
    expect((serialized.meta as Record<string, unknown>).detail).toMatchObject({ message: 'nested' });
  });

  it('does not throw on circular references and truncates at max depth', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    let serialized: unknown;
    expect(() => {
      serialized = serializeValue(circular);
    }).not.toThrow();
    expect(JSON.stringify(serialized)).toContain('"[MaxDepth]"');

    const shallow: Record<string, unknown> = { child: circular };
    const shallowSerialized = serializeValue(shallow) as Record<string, unknown>;
    expect(JSON.stringify(shallowSerialized.child)).toContain('"[MaxDepth]"');
  });

  it('truncates deep nesting beyond MAX_SERIALIZE_DEPTH', () => {
    let nested: unknown = 'leaf';
    for (let i = 0; i <= MAX_SERIALIZE_DEPTH + 2; i += 1) {
      nested = { value: nested };
    }
    const serialized = serializeValue(nested) as Record<string, unknown>;
    expect(JSON.stringify(serialized)).toContain('"[MaxDepth]"');
  });

  it('preserves JSON.stringify-compatible values such as Date', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(serializeValue(date)).toBe(date.toISOString());
    expect(JSON.stringify(serializeValue({ at: date }))).toBe(JSON.stringify({ at: date.toISOString() }));
  });

  it('truncates deep cause chains and arrays at max depth', () => {
    let cause: Error | undefined = new Error('leaf');
    for (let i = 0; i < MAX_SERIALIZE_DEPTH + 2; i += 1) {
      cause = new Error(`level-${i}`, { cause });
    }
    const serialized = serializeValue(cause) as Record<string, unknown>;
    expect(JSON.stringify(serialized)).toContain('"[MaxDepth]"');

    let array: unknown = 'leaf';
    for (let i = 0; i < MAX_SERIALIZE_DEPTH + 2; i += 1) {
      array = [array];
    }
    const arraySerialized = serializeValue(array) as unknown[];
    expect(JSON.stringify(arraySerialized)).toContain('"[MaxDepth]"');
  });

  it('omits the stack key when an error has no string stack', () => {
    const error = new Error('no stack');
    delete (error as Partial<Error>).stack;
    const serialized = serializeValue(error) as Record<string, unknown>;
    expect(serialized).toEqual({ message: 'no stack' });
  });

  it('leaves primitives untouched', () => {
    expect(serializeValue('text')).toBe('text');
    expect(serializeValue(42)).toBe(42);
    expect(serializeValue(true)).toBe(true);
    expect(serializeValue(null)).toBe(null);
    expect(serializeValue(undefined)).toBe(undefined);
  });
});

describe('Logger.write', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flushes an empty buffer without error', () => {
    const logger = new Logger();
    expect(() => logger.flush()).not.toThrow();
  });

  it('emits a valid JSON line with Error expanded, without throwing on circular meta', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = new Logger();

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const meta: Record<string, unknown> = { error: new Error('boom'), circular };
    expect(() => logger.error('request failed', meta)).not.toThrow();

    const line = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.level).toBe('error');
    expect(parsed.message).toBe('request failed');
    expect(parsed.error).toMatchObject({ message: 'boom' });
    expect(JSON.stringify(parsed.circular)).toContain('"[MaxDepth]"');
  });
});

describe('Logger file rotation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rotates the log file and shifts existing backups', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-logger-rotate-'));
    const logPath = path.join(dir, 'v2.log');
    fs.writeFileSync(logPath, 'x'.repeat(5 * 1024 * 1024));
    for (const suffix of ['.1', '.2', '.3', '.4']) {
      fs.writeFileSync(`${logPath}${suffix}`, suffix);
    }
    try {
      const logger = new Logger({ logDir: dir });
      logger.error('trigger rotation');
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(fs.existsSync(`${logPath}.5`)).toBe(true);
      expect(fs.readFileSync(`${logPath}.4`, 'utf8')).toBe('.3');
      expect(fs.readFileSync(`${logPath}.1`, 'utf8')).toBe('x'.repeat(5 * 1024 * 1024));
      expect(fs.existsSync(logPath)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
