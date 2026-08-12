import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import type { AppContext } from '../../../domain/contracts';
import { PayMethodService, type PayMethodNode } from './pay-method';

describe('PayMethodService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-pay-method-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date('2026-08-05T10:00:00.000Z'),
    };
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', now);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertPayMethod(
    id: string,
    name: string,
    options: { parentId?: string | null; sortOrder?: number; active?: boolean; remark?: string | null; deletedAt?: string | null } = {},
  ): void {
    db.prepare(
      `INSERT INTO PayMethod (
         id, clinicId, createdAt, updatedAt, deletedAt,
         name, parentId, sortOrder, active, remark
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      context.clinicId,
      now,
      now,
      options.deletedAt ?? null,
      name,
      options.parentId ?? null,
      options.sortOrder ?? 0,
      options.active === undefined ? 1 : options.active ? 1 : 0,
      options.remark ?? null,
    );
  }

  it('returns an empty tree when no pay methods exist', () => {
    const service = new PayMethodService(db);
    expect(service.tree(context).items).toEqual([]);
  });

  it('builds a two-level tree with children nested under roots', () => {
    insertPayMethod('pm-root-cash', '现金');
    insertPayMethod('pm-root-electronic', '电子支付');
    insertPayMethod('pm-child-wechat', '微信', { parentId: 'pm-root-electronic', sortOrder: 2 });
    insertPayMethod('pm-child-alipay', '支付宝', { parentId: 'pm-root-electronic', sortOrder: 1 });

    const service = new PayMethodService(db);
    const items = service.tree(context).items;
    const rootIds = items.map((node) => node.id);
    expect(rootIds).toEqual(['pm-root-cash', 'pm-root-electronic']);
    const electronic = items.find((node) => node.id === 'pm-root-electronic')!;
    expect(electronic.parentId).toBeNull();
    expect(electronic.children.map((child) => child.id)).toEqual(['pm-child-alipay', 'pm-child-wechat']);
    const alipay = electronic.children[0];
    expect(alipay).toMatchObject({ id: 'pm-child-alipay', name: '支付宝', parentId: 'pm-root-electronic', active: true });
    expect(alipay.children).toEqual([]);
  });

  it('sorts children by sortOrder then name, and keeps shape fields', () => {
    insertPayMethod('pm-sort-root', '排序根', { sortOrder: 5, remark: '排序用' });
    insertPayMethod('pm-sort-b', 'B', { parentId: 'pm-sort-root', sortOrder: 1 });
    insertPayMethod('pm-sort-a', 'A', { parentId: 'pm-sort-root', sortOrder: 1 });
    insertPayMethod('pm-sort-hi', '高优先级', { parentId: 'pm-sort-root', sortOrder: 0, active: false });

    const service = new PayMethodService(db);
    const items = service.tree(context).items;
    const root = items.find((node) => node.id === 'pm-sort-root')!;
    expect(root.remark).toBe('排序用');
    expect(root.sortOrder).toBe(5);
    expect(root.children.map((child) => child.id)).toEqual(['pm-sort-hi', 'pm-sort-a', 'pm-sort-b']);
    expect(root.children[1].active).toBe(true);
    expect(root.children[0].active).toBe(false);
  });

  it('excludes soft-deleted pay methods from the tree', () => {
    insertPayMethod('pm-deleted', '已删除方式', { deletedAt: now });
    insertPayMethod('pm-deleted-parent', '已删除父级', { deletedAt: now });
    insertPayMethod('pm-deleted-child', '已删除子级', { parentId: 'pm-deleted', deletedAt: now });
    insertPayMethod('pm-orphan-child', '孤儿子级', { parentId: 'pm-deleted-parent' });

    const service = new PayMethodService(db);
    const ids = service.tree(context).items.map((node) => node.id);
    expect(ids).not.toContain('pm-deleted');
    expect(ids).not.toContain('pm-deleted-parent');
    expect(ids).not.toContain('pm-deleted-child');
    // 父级被软删后，未删除的子级提升为根（标准孤儿处理）。
    expect(ids).toContain('pm-orphan-child');
    const orphan = service.tree(context).items.find((node) => node.id === 'pm-orphan-child')!;
    expect(orphan.parentId).toBe('pm-deleted-parent');
  });

  it('treats empty-string parentId as root', () => {
    insertPayMethod('pm-empty-parent', '空父级', { parentId: '' });
    const service = new PayMethodService(db);
    const item = service.tree(context).items.find((node) => node.id === 'pm-empty-parent') as PayMethodNode | undefined;
    expect(item).toBeDefined();
    expect(item!.parentId).toBeNull();
  });
});
