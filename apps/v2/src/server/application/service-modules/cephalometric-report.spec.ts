import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { CephalometricReportService } from './cephalometric-report';

describe('CephalometricReportService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-cephalometric-report-'));
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
    // 种子演示预约使用真实当前时间，可能与固定测试日期重叠；移到遥远的未来。
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertCase(
    id: string,
    extra: { landmarksJson?: string; metricsJson?: string; reportJson?: string; reportStatus?: string; remark?: string } = {},
  ): void {
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, metricsJson, status, remark, reportJson, reportStatus
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`,
    ).run(
      id,
      context.clinicId,
      now,
      now,
      'patient-demo-001',
      `https://img.example.com/${id}.png`,
      extra.landmarksJson ?? '{}',
      extra.metricsJson ?? '{}',
      extra.remark ?? null,
      extra.reportJson ?? '{}',
      extra.reportStatus ?? 'DRAFT',
    );
  }

  it('saves a report with default COMPLETED status and persists JSON', () => {
    insertCase('case-save-1');
    const service = new CephalometricReportService(db);

    const result = service.saveReport('case-save-1', {
      reportJson: { snLength: 71.2, interincisalAngle: 124.5 },
    }, context);

    expect(result).toEqual({ caseId: 'case-save-1', reportStatus: 'COMPLETED' });
    const row = db.prepare('SELECT reportJson, reportStatus FROM CephalometricCase WHERE id = ?').get('case-save-1') as { reportJson: string; reportStatus: string };
    expect(row.reportStatus).toBe('COMPLETED');
    expect(JSON.parse(row.reportJson)).toEqual({ snLength: 71.2, interincisalAngle: 124.5 });
  });

  it('saves a report from a JSON string and honors explicit reportStatus', () => {
    insertCase('case-save-2');
    const service = new CephalometricReportService(db);

    const result = service.saveReport('case-save-2', {
      reportJson: '{"snaAngle":82.1,"snbAngle":79.3}',
      reportStatus: 'FINAL',
    }, context);

    expect(result.reportStatus).toBe('FINAL');
    const row = db.prepare('SELECT reportJson, reportStatus FROM CephalometricCase WHERE id = ?').get('case-save-2') as { reportJson: string; reportStatus: string };
    expect(row.reportStatus).toBe('FINAL');
    expect(JSON.parse(row.reportJson)).toEqual({ snaAngle: 82.1, snbAngle: 79.3 });
  });

  it('rejects invalid reportJson strings and non-object values', () => {
    insertCase('case-save-3');
    const service = new CephalometricReportService(db);

    expect(() => service.saveReport('case-save-3', { reportJson: '{not-json' }, context)).toThrow(ValidationError);
    expect(() => service.saveReport('case-save-3', { reportJson: '[1,2,3]' }, context)).toThrow(ValidationError);
    expect(() => service.saveReport('case-save-3', { reportJson: 'null' }, context)).toThrow(ValidationError);
  });

  it('throws NotFound when saving a report for a missing case', () => {
    const service = new CephalometricReportService(db);
    expect(() => service.saveReport('case-missing', { reportJson: { a: 1 } }, context)).toThrow(NotFoundError);
  });

  it('returns a parsed report with metrics and landmarks', () => {
    insertCase('case-get-1', {
      landmarksJson: JSON.stringify({ sella: [10, 20], nasion: [30, 40] }),
      metricsJson: JSON.stringify({ snLength: 71.2 }),
      reportJson: JSON.stringify({ conclusion: '正常' }),
      reportStatus: 'COMPLETED',
    });
    const service = new CephalometricReportService(db);

    const report = service.getReport('case-get-1', context);

    expect(report.caseId).toBe('case-get-1');
    expect(report.patientId).toBe('patient-demo-001');
    expect(report.reportStatus).toBe('COMPLETED');
    expect(report.reportJson).toEqual({ conclusion: '正常' });
    expect(report.metricsJson).toEqual({ snLength: 71.2 });
    expect(report.landmarksJson).toEqual({ sella: [10, 20], nasion: [30, 40] });
    expect(report.createdAt).toBe(now);
  });

  it('returns empty objects for unparseable JSON fields', () => {
    insertCase('case-get-2', {
      landmarksJson: '{broken',
      metricsJson: 'not-json',
      reportJson: '',
    });
    const service = new CephalometricReportService(db);

    const report = service.getReport('case-get-2', context);

    expect(report.reportJson).toEqual({});
    expect(report.metricsJson).toEqual({});
    expect(report.landmarksJson).toEqual({});
  });

  it('passes non-string JSON objects through instead of parsing them', () => {
    const service = new CephalometricReportService(db);
    const originalPrepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('FROM CephalometricCase WHERE id = ?')) {
        return {
          get: () => ({
            id: 'case-get-object',
            patientId: 'patient-demo-001',
            reportJson: { conclusion: '对象输入' },
            reportStatus: 'COMPLETED',
            metricsJson: { snLength: 71.2 },
            landmarksJson: { sella: [10, 20] },
            createdAt: now,
          }),
        } as never;
      }
      return originalPrepare(sql);
    });
    try {
      const report = service.getReport('case-get-object', context);
      expect(report.reportJson).toEqual({ conclusion: '对象输入' });
      expect(report.metricsJson).toEqual({ snLength: 71.2 });
      expect(report.landmarksJson).toEqual({ sella: [10, 20] });
    } finally {
      spy.mockRestore();
    }
  });

  it('throws NotFound when reading a missing case report', () => {
    const service = new CephalometricReportService(db);
    expect(() => service.getReport('case-get-missing', context)).toThrow(NotFoundError);
  });

  it('writes a WechatMessage record on send with default content', () => {
    insertCase('case-send-1');
    const service = new CephalometricReportService(db);

    const result = service.sendWechat('case-send-1', {}, context);

    expect(result.messageId).toBeDefined();
    expect(result).toMatchObject({ patientId: 'patient-demo-001', type: 'CEPHALOMETRIC_REPORT', status: 'SENT', sentAt: now });
    const row = db.prepare('SELECT * FROM WechatMessage WHERE id = ?').get(result.messageId as string) as Record<string, unknown>;
    expect(row.clinicId).toBe('clinic-v2-001');
    expect(row.patientId).toBe('patient-demo-001');
    expect(row.type).toBe('CEPHALOMETRIC_REPORT');
    expect(row.status).toBe('SENT');
    expect(row.sentAt).toBe(now);
    expect(row.content).toBe('测量报告已生成，请查收');
    expect(row.remark).toBeNull();
  });

  it('writes note and phone into the WechatMessage record', () => {
    insertCase('case-send-2');
    const service = new CephalometricReportService(db);

    const result = service.sendWechat('case-send-2', { note: '您的测量报告已完成，请查收', phone: '13800000000' }, context);

    const row = db.prepare('SELECT content, remark FROM WechatMessage WHERE id = ?').get(result.messageId as string) as { content: string; remark: string };
    expect(row.content).toBe('您的测量报告已完成，请查收');
    expect(row.remark).toBe('phone:13800000000');
  });

  it('throws NotFound when sending for a missing case', () => {
    const service = new CephalometricReportService(db);
    expect(() => service.sendWechat('case-send-missing', { note: 'x' }, context)).toThrow(NotFoundError);
  });

  it('compares multiple cases with parsed JSON payloads', () => {
    insertCase('case-cmp-1', { landmarksJson: JSON.stringify({ sella: [10, 20] }), metricsJson: JSON.stringify({ snLength: 70 }), remark: '基线' });
    insertCase('case-cmp-2', { landmarksJson: JSON.stringify({ sella: [12, 21] }), metricsJson: JSON.stringify({ snLength: 72 }), remark: '随访' });
    const service = new CephalometricReportService(db);

    const result = service.compare(['case-cmp-1', 'case-cmp-2'], context);

    expect(result.cases).toHaveLength(2);
    expect(result.cases.map((row) => row.id)).toEqual(['case-cmp-1', 'case-cmp-2']);
    const first = result.cases[0];
    expect(first.patientId).toBe('patient-demo-001');
    expect(first.imageUrl).toBe('https://img.example.com/case-cmp-1.png');
    expect(first.landmarksJson).toEqual({ sella: [10, 20] });
    expect(first.metricsJson).toEqual({ snLength: 70 });
    expect(first.createdAt).toBe(now);
    expect(first.remark).toBe('基线');
  });

  it('rejects invalid compare inputs', () => {
    const service = new CephalometricReportService(db);
    expect(() => service.compare([], context)).toThrow(ValidationError);
    expect(() => service.compare(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'], context)).toThrow(ValidationError);
    expect(() => service.compare('not-array' as unknown as string[], context)).toThrow(ValidationError);
  });

  it('throws NotFound when a compared case is missing', () => {
    insertCase('case-cmp-3');
    const service = new CephalometricReportService(db);
    expect(() => service.compare(['case-cmp-3', 'case-cmp-missing'], context)).toThrow(NotFoundError);
  });
});
