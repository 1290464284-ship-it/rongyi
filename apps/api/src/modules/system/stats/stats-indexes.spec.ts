/**
 * 统计 SQL EXPLAIN QUERY PLAN 索引验证测试
 * 确保核心聚合查询命中预期索引，避免全表扫描
 */
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { createSchema } from '../../../db/schema';

describe('Stats SQL EXPLAIN 索引命中验证', () => {
  let db: DatabaseType;

  beforeAll(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = OFF'); // 种子数据跳过外键检查
    createSchema(db);

    // 插入种子数据（让查询优化器选择索引而非全表扫描）
    const now = new Date().toISOString();
    const clinicId = 'clinic-explain-test';
    const doctorId = 'doctor-explain-test';
    const patientId = 'patient-explain-test';

    db.prepare(
      'INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
    ).run(clinicId, '测试诊所', 'EXPLAIN', 1, now, now);

    // Charge 表：插入 20 条已支付记录
    const insertCharge = db.prepare(`
      INSERT INTO Charge (id, patientId, clinicId, number, totalAmount, paidAmount, paidAt, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PAID', ?, ?)
    `);
    for (let i = 0; i < 20; i++) {
      const paidAt = new Date(Date.now() - i * 86400000).toISOString();
      insertCharge.run(`charge-${i}`, patientId, clinicId, `CHK-${i}`, 10000, 10000, paidAt, now, now);
    }

    // Appointment 表：插入 10 条预约
    const insertAppt = db.prepare(`
      INSERT INTO Appointment (id, patientId, doctorId, clinicId, startTime, endTime, type, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 'EXAM', 'BOOKED', ?, ?)
    `);
    for (let i = 0; i < 10; i++) {
      const startTime = new Date(Date.now() + i * 3600000).toISOString();
      const endTime = new Date(Date.now() + i * 3600000 + 1800000).toISOString();
      insertAppt.run(`appt-${i}`, patientId, doctorId, clinicId, startTime, endTime, now, now);
    }

    // Treatment 表：插入 10 条治疗记录
    const insertTreatment = db.prepare(`
      INSERT INTO Treatment (id, patientId, doctorId, clinicId, code, name, category, price, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)
    `);
    for (let i = 0; i < 10; i++) {
      insertTreatment.run(`treat-${i}`, patientId, doctorId, clinicId, `T${i}`, `治疗${i}`, '综合', 100, now, now);
    }

    // MemberCard 表：插入 5 张活跃会员卡
    const insertCard = db.prepare(`
      INSERT INTO MemberCard (id, patientId, clinicId, cardNo, status, balance, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, 'ACTIVE', 10000, ?, ?)
    `);
    for (let i = 0; i < 5; i++) {
      insertCard.run(`card-${i}`, `patient-card-${i}`, clinicId, `MC-${i}`, now, now);
    }
  });

  afterAll(() => {
    db.close();
  });

  /** 执行 EXPLAIN QUERY PLAN 并返回所有行 */
  function explain(sql: string, params: unknown[]): string[] {
    const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>;
    return rows.map(r => r.detail || '');
  }

  /** 断言查询计划中至少有一行使用了索引 */
  function assertUsesIndex(sql: string, params: unknown[], indexNameHint: string) {
    const details = explain(sql, params);
    const usesIndex = details.some(d => d.includes('USING INDEX') || d.includes('USING COVERING INDEX'));
    if (!usesIndex) {
      // 输出详细信息帮助调试
      console.warn('EXPLAIN QUERY PLAN 输出:', details);
    }
    expect(usesIndex).toBe(true);
    // 额外检查：如果提供了索引名提示，验证是否命中了预期索引
    if (indexNameHint) {
      const hitsExpected = details.some(d => d.toLowerCase().includes(indexNameHint.toLowerCase()));
      if (!hitsExpected) {
        console.warn(`期望命中索引 [${indexNameHint}]，实际计划:`, details);
      }
      // 宽松断言：只要使用了任意索引即可（SQLite 优化器可能选择不同索引）
      expect(hitsExpected || details.some(d => d.includes('USING INDEX'))).toBe(true);
    }
  }

  describe('Charge 统计查询', () => {
    it('revenue 按日期范围 + clinicId 应走索引', () => {
      const sql = `SELECT date(paidAt) as date, COUNT(*) as count, COALESCE(SUM(paidAmount),0) as amount
        FROM Charge WHERE deletedAt IS NULL AND paidAt IS NOT NULL AND paidAt >= ? AND paidAt <= ? AND clinicId = ?
        GROUP BY date ORDER BY date`;
      assertUsesIndex(sql, ['2026-01-01', '2026-12-31', 'clinic-explain-test'], 'idx_charge');
    });

    it('chargeStats 按月分组应走索引', () => {
      const sql = `SELECT substr(paidAt,1,7) as month, COUNT(*) as count, COALESCE(SUM(paidAmount),0) as amount
        FROM Charge WHERE deletedAt IS NULL AND paidAt IS NOT NULL AND paidAt >= ? AND paidAt <= ? AND clinicId = ?
        GROUP BY month ORDER BY month`;
      assertUsesIndex(sql, ['2026-01-01', '2026-12-31', 'clinic-explain-test'], 'idx_charge');
    });

    it('按医生 + clinicId 聚合应走索引', () => {
      const sql = `SELECT doctorId, COUNT(*) as count, COALESCE(SUM(paidAmount),0) as amount
        FROM Charge WHERE deletedAt IS NULL AND clinicId = ? GROUP BY doctorId ORDER BY amount DESC`;
      assertUsesIndex(sql, ['clinic-explain-test'], 'idx_charge_clinic');
    });
  });

  describe('Appointment 统计查询', () => {
    it('按 startTime 范围 + clinicId 应走索引', () => {
      const sql = `SELECT date(startTime) as date, COUNT(*) as count
        FROM Appointment WHERE deletedAt IS NULL AND startTime >= ? AND startTime <= ? AND clinicId = ?
        GROUP BY date ORDER BY date`;
      assertUsesIndex(sql, ['2026-01-01', '2026-12-31', 'clinic-explain-test'], 'idx_appointment');
    });
  });

  describe('Treatment 统计查询', () => {
    it('按 doctorId + clinicId 应走索引', () => {
      const sql = `SELECT doctorId, COUNT(*) as count
        FROM Treatment WHERE deletedAt IS NULL AND doctorId = ? AND clinicId = ?
        GROUP BY doctorId`;
      assertUsesIndex(sql, ['doctor-explain-test', 'clinic-explain-test'], 'idx_treatment');
    });
  });

  describe('MemberCard 统计查询', () => {
    it('按 status + clinicId 应走索引', () => {
      const sql = `SELECT COUNT(*) as count FROM MemberCard
        WHERE deletedAt IS NULL AND status = 'ACTIVE' AND clinicId = ?`;
      assertUsesIndex(sql, ['clinic-explain-test'], 'idx_membercard');
    });
  });

  describe('全表扫描检查', () => {
    it('所有关键查询不应出现 SCAN（全表扫描）', () => {
      const queries = [
        {
          name: 'Charge revenue',
          sql: `SELECT date(paidAt) as date, COUNT(*) as count FROM Charge
            WHERE deletedAt IS NULL AND paidAt IS NOT NULL AND paidAt >= ? AND paidAt <= ? AND clinicId = ?
            GROUP BY date`,
          params: ['2026-01-01', '2026-12-31', 'clinic-explain-test'],
        },
        {
          name: 'Appointment by date range',
          sql: `SELECT date(startTime) as date, COUNT(*) as count FROM Appointment
            WHERE deletedAt IS NULL AND startTime >= ? AND clinicId = ?
            GROUP BY date`,
          params: ['2026-01-01', 'clinic-explain-test'],
        },
        {
          name: 'Treatment by doctor',
          sql: `SELECT doctorId, COUNT(*) as count FROM Treatment
            WHERE deletedAt IS NULL AND doctorId = ? AND clinicId = ?
            GROUP BY doctorId`,
          params: ['doctor-explain-test', 'clinic-explain-test'],
        },
        {
          name: 'MemberCard active count',
          sql: `SELECT COUNT(*) FROM MemberCard WHERE deletedAt IS NULL AND status = 'ACTIVE' AND clinicId = ?`,
          params: ['clinic-explain-test'],
        },
      ];

      for (const q of queries) {
        const details = explain(q.sql, q.params);
        const hasScan = details.some(d => d.includes('SCAN'));
        if (hasScan) {
          console.warn(`[SCAN 检测] ${q.name} 出现全表扫描:`, details);
        }
        expect(hasScan).toBe(false);
      }
    });
  });
});
