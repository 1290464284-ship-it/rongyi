import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';

/**
 * Request context stored in AsyncLocalStorage.
 * Available throughout the request lifecycle without explicit parameter passing.
 */
export interface RequestContext {
  /** Unique identifier for tracing logs across the request */
  traceId: string;
  /** Authenticated user ID (if available) */
  userId?: string;
  /** Request start timestamp (ISO string) */
  requestStart?: string;
}

/**
 * Global AsyncLocalStorage instance for request context.
 *
 * Usage:
 * - In interceptor: als.run(context, () => next.handle())
 * - In any async function: als.getStore()?.traceId
 */
export const als = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current request context.
 * Returns undefined if called outside a request context.
 */
export function getRequestContext(): RequestContext | undefined {
  return als.getStore();
}

/**
 * Get the current trace ID.
 * Returns undefined if called outside a request context.
 */
export function getTraceId(): string | undefined {
  return als.getStore()?.traceId;
}

/**
 * Get the current user ID.
 * Returns undefined if called outside a request context or user not authenticated.
 */
export function getCurrentUserId(): string | undefined {
  return als.getStore()?.userId;
}

/**
 * Generate a new trace ID.
 * Uses crypto.randomUUID() for uniqueness.
 */
export function generateTraceId(): string {
  return crypto.randomUUID();
}

/**
 * Run a function within a request context.
 * This is typically called by the logging interceptor.
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return als.run(context, fn);
}