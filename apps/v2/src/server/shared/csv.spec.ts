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
    expect(csvCell({ a: 1 })).toBe('"{\"\"a\"\":1}"');
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

  it('streams an iterable to a response with a UTF-8 BOM and CSV headers', async () => {
    const writes: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on('data', (chunk: Buffer) => writes.push(Buffer.from(chunk)));
    const res = Object.assign(passthrough, { setHeader: () => undefined }) as unknown as Response;
    await streamCsvResponse(
      res,
      'rows.csv',
      [{ key: 'id' }, { key: 'name' }],
      Readable.from([{ id: '1', name: 'One' }], { objectMode: true }),
    );
    expect(writes.some((chunk) => chunk.equals(Buffer.from([0xef, 0xbb, 0xbf])))).toBe(true);
    expect(writes.some((chunk) => chunk.toString().includes('"id","name"'))).toBe(true);
  });
});
