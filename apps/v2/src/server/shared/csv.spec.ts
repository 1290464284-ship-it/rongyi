import { describe, expect, it } from 'vitest';
import { createCsvStream, csvCell, streamCsvResponse } from './csv';
import { PassThrough, Readable } from 'node:stream';
import type { Response } from 'express';

describe('shared CSV helpers', () => {
  it('escapes quotes and neutralizes formula-leading values', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('a=b')).toBe('"a=b"');
    expect(csvCell({ a: 1 })).toBe('"{\"\"a\"\":1}"');
    // B-4 属性测试探针：toJSON 返回 undefined 的对象此前抛 TypeError
    expect(csvCell({ toJSON: () => undefined })).toBe('"[object Object]"');
  });

  it('emits a header followed by object-mode rows', async () => {
    const chunks: string[] = [];
    const stream = createCsvStream<{ id: string; name: string }>(
      [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }],
      { truncated: true },
    );
    stream.on('data', (chunk) => chunks.push(String(chunk)));
    const done = new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    stream.write({ id: '1', name: 'Alice' });
    stream.write({ id: '2', name: '=BOB' });
    stream.end();
    await done;
    expect(chunks.join('')).toBe('"ID","Name"\r\n"1","Alice"\r\n"2","\'=BOB"\r\n# truncated\r\n');
  });

  it('omits the truncation marker when truncated is not requested', async () => {
    const chunks: string[] = [];
    const stream = createCsvStream<{ id: string }>([{ key: 'id' }]);
    stream.on('data', (chunk) => chunks.push(String(chunk)));
    const done = new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    stream.write({ id: '1' });
    stream.end();
    await done;
    expect(chunks.join('')).toBe('"id"\r\n"1"\r\n');
  });

  it('streams an iterable to a response with a UTF-8 BOM and CSV headers', async () => {
    const writes: Buffer[] = [];
    const headers: Record<string, string> = {};
    const passthrough = new PassThrough();
    passthrough.on('data', (chunk: Buffer) => writes.push(Buffer.from(chunk)));
    const res = Object.assign(passthrough, {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    }) as unknown as Response;
    await streamCsvResponse(
      res,
      'rows.csv',
      [{ key: 'id' }, { key: 'name' }],
      Readable.from([{ id: '1', name: 'One' }], { objectMode: true }),
    );
    expect(writes.some((chunk) => chunk.equals(Buffer.from([0xef, 0xbb, 0xbf])))).toBe(true);
    expect(writes.some((chunk) => chunk.toString().includes('"id","name"'))).toBe(true);
    expect(headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(headers['content-disposition']).toBe('attachment; filename="rows.csv"');
  });

  it('applies the mapRow option to each row before serialization', async () => {
    const writes: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on('data', (chunk: Buffer) => writes.push(Buffer.from(chunk)));
    const res = Object.assign(passthrough, {
      setHeader: () => {},
    }) as unknown as Response;
    await streamCsvResponse(
      res,
      'mapped.csv',
      [{ key: 'id' }, { key: 'name' }],
      Readable.from([{ id: '1', name: 'One' }], { objectMode: true }),
      { mapRow: (row) => ({ id: row.id, name: `Mapped ${row.name}` }) },
    );
    const body = writes.map((chunk) => chunk.toString()).join('');
    expect(body).toContain('"1","Mapped One"');
  });

  it('forwards row serialization errors to the stream callback', async () => {
    const stream = createCsvStream<{ id: unknown }>([{ key: 'id' }]);
    const error = new Promise<Error>((resolve) => {
      stream.on('error', resolve);
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    stream.write({ id: circular });
    await expect(error).resolves.toBeInstanceOf(Error);
  });
});
