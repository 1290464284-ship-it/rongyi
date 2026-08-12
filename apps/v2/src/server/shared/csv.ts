import { Transform } from 'node:stream';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface CsvColumn<T = Record<string, unknown>> {
  key: keyof T & string;
  label?: string;
}

/**
 * Shared CSV escaping used by both resource exports and follow-up exports.
 * Formula injection is neutralized by prefixing dangerous leading characters.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/**
 * Builds a CSV line from columns. Kept exported because callers occasionally
 * need to render a single header or row outside the streaming path.
 */
function csvLine<T extends Record<string, unknown>>(
  columns: ReadonlyArray<CsvColumn<T>>,
  row: T,
): string {
  return columns.map((column) => csvCell(row[column.key])).join(',');
}

/**
 * Creates an object-mode transform stream that emits a CSV document.
 * The first row is the header; the caller can feed rows lazily so large
 * exports never need to materialize the entire result set in memory.
 */
export function createCsvStream<T extends Record<string, unknown>>(
  columns: ReadonlyArray<CsvColumn<T>>,
  options: { truncated?: boolean; newline?: string } = {},
): Transform {
  const newline = options.newline ?? '\r\n';
  let headerSent = false;

  return new Transform({
    objectMode: true,
    transform(row: T, _encoding, callback) {
      try {
        if (!headerSent) {
          this.push(`${columns.map((column) => csvCell(column.label ?? column.key)).join(',')}${newline}`);
          headerSent = true;
        }
        this.push(`${csvLine(columns, row)}${newline}`);
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      if (options.truncated) this.push(`# truncated${newline}`);
      callback();
    },
  });
}

export interface StreamCsvOptions<T extends Record<string, unknown>> {
  truncated?: boolean;
  newline?: string;
  mapRow?: (row: T) => T;
}

/**
 * Streams an iterable of records to an Express response with UTF-8 BOM and
 * backpressure. This is the single entry point for true streaming exports.
 */
export async function streamCsvResponse<T extends Record<string, unknown>>(
  res: Response,
  filename: string,
  columns: ReadonlyArray<CsvColumn<T>>,
  rows: Iterable<T> | AsyncIterable<T>,
  options: StreamCsvOptions<T> = {},
): Promise<void> {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.write('\uFEFF');

  const mapper = options.mapRow;
  const rowStream = Readable.from(
    (async function* () {
      for await (const row of rows) {
        yield mapper ? mapper(row) : row;
      }
    })(),
    { objectMode: true },
  );
  await pipeline(rowStream, createCsvStream(columns, options), res);
}
