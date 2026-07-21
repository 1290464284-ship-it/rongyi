import { Injectable, BadRequestException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { Database } from 'better-sqlite3';
import * as crypto from 'crypto';

export interface IdempotentOptions {
  key: string;
  type: string;
  ttlMs?: number;
}

export interface IdempotencyRecord {
  id: string;
  key: string;
  type: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  result?: string;
  createdAt: string;
  expiresAt: string;
}

@Injectable()
export class IdempotencyService {
  constructor(private dbService: DbService) {}

  async execute<T>(
    options: IdempotentOptions,
    handler: () => Promise<T> | T,
  ): Promise<T> {
    const { key, type, ttlMs = 24 * 60 * 60 * 1000 } = options;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const recordId = crypto.randomUUID();

    const existing = this.dbService.prepare(
      'SELECT * FROM IdempotencyRecord WHERE key = ? AND expiresAt > ?',
    ).get(key, now) as IdempotencyRecord | undefined;

    if (existing) {
      if (existing.status === 'COMPLETED' && existing.result) {
        return JSON.parse(existing.result);
      }
      if (existing.status === 'PROCESSING') {
        throw new BadRequestException('处理中，请稍后再试');
      }
      // P1 修复（FAILED 阻塞重试）：FAILED 记录应允许重试，删除后继续创建新记录
      if (existing.status === 'FAILED') {
        this.dbService.prepare('DELETE FROM IdempotencyRecord WHERE id = ?').run(existing.id);
      }
    }

    try {
      this.dbService.prepare(
        'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(recordId, key, type, 'PROCESSING', now, expiresAt);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
        const retryExisting = this.dbService.prepare(
          'SELECT * FROM IdempotencyRecord WHERE key = ?',
        ).get(key) as IdempotencyRecord | undefined;
        if (retryExisting?.status === 'COMPLETED' && retryExisting.result) {
          return JSON.parse(retryExisting.result);
        }
        throw new BadRequestException('处理中，请稍后再试');
      }
      throw e;
    }

    try {
      const result = await handler();
      this.dbService.prepare(
        "UPDATE IdempotencyRecord SET status = 'COMPLETED', result = ? WHERE id = ?",
      ).run(JSON.stringify(result), recordId);
      return result;
    } catch (e) {
      this.dbService.prepare(
        "UPDATE IdempotencyRecord SET status = 'FAILED', result = ? WHERE id = ?",
      ).run(JSON.stringify({ error: (e as Error).message }), recordId);
      throw e;
    }
  }

  executeInTransaction<T>(
    options: IdempotentOptions,
    handler: (db: Database) => T,
  ): T {
    const { key, type, ttlMs = 24 * 60 * 60 * 1000 } = options;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const recordId = crypto.randomUUID();

    return this.dbService.transaction((db) => {
      const existing = db.prepare(
        'SELECT * FROM IdempotencyRecord WHERE key = ? AND expiresAt > ?',
      ).get(key, now) as IdempotencyRecord | undefined;

      if (existing) {
        if (existing.status === 'COMPLETED' && existing.result) {
          return JSON.parse(existing.result) as T;
        }
        if (existing.status === 'PROCESSING') {
          throw new BadRequestException('处理中，请稍后再试');
        }
        // P1 修复（FAILED 阻塞重试）：FAILED 记录应允许重试，删除后继续创建新记录
        if (existing.status === 'FAILED') {
          db.prepare('DELETE FROM IdempotencyRecord WHERE id = ?').run(existing.id);
        }
      }

      try {
        db.prepare(
          'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(recordId, key, type, 'PROCESSING', now, expiresAt);
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
          const retryExisting = db.prepare(
            'SELECT * FROM IdempotencyRecord WHERE key = ?',
          ).get(key) as IdempotencyRecord | undefined;
          if (retryExisting?.status === 'COMPLETED' && retryExisting.result) {
            return JSON.parse(retryExisting.result) as T;
          }
          throw new BadRequestException('处理中，请稍后再试');
        }
        throw e;
      }

      try {
        const result = handler(db);
        db.prepare(
          "UPDATE IdempotencyRecord SET status = 'COMPLETED', result = ? WHERE id = ?",
        ).run(JSON.stringify(result), recordId);
        return result;
      } catch (e) {
        db.prepare(
          "UPDATE IdempotencyRecord SET status = 'FAILED', result = ? WHERE id = ?",
        ).run(JSON.stringify({ error: (e as Error).message }), recordId);
        throw e;
      }
    });
  }
}
