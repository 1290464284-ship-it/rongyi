import { friendlyError } from './messages';
import { ClientError } from './api-errors';

interface FetchOptions extends RequestInit {
  idempotent?: boolean;
}

const REQUEST_TIMEOUT_MS = 15_000;

export async function fetchWithRetry(input: RequestInfo | URL, init: FetchOptions = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD' || init.idempotent === true;
  const traceparent = createTraceparent();
  let lastError: unknown;
  for (let attempt = 0; attempt < (isIdempotent ? 2 : 1); attempt += 1) {
    try {
      const headers = new Headers(init.headers);
      if (traceparent && !headers.has('traceparent')) headers.set('traceparent', traceparent);
      const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
      return await fetch(input, { ...init, headers, signal });
    } catch (error) {
      lastError = error;
      if (isIdempotent && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw new ClientError(friendlyError(error instanceof Error ? error.message : String(error)));
    }
  }
  throw lastError;
}

function createTraceparent(): string | undefined {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) return undefined;
  const bytes = cryptoObj.getRandomValues(new Uint8Array(24));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `00-${hex.slice(0, 32)}-${hex.slice(32, 48)}-01`;
}

export function pagedPath(path: string, page: number, pageSize: number): string {
  const [base, query = ''] = path.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  // page/pageSize 恒被写入，qs 不可能为空。
  return `${base}?${params.toString()}`;
}

export function cursorPath(path: string, cursor: string, pageSize: number): string {
  const [base, query = ''] = path.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('pageSize', String(pageSize));
  params.set('cursor', cursor);
  // pageSize/cursor 恒被写入，qs 不可能为空。
  return `${base}?${params.toString()}`;
}
