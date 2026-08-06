import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { ChargeService, MemberCardService } from './financial';
import { RefundFlowService } from './refund-flow';

describe('RefundFlowService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-refund-flow-'));
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
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function createPaidCharge(amount: number, method: string): Promise<string> {
    const chargeService = new ChargeService(db);
    const charge = await chargeService.create({
      patientId: 'patient-demo-001',
      items: [{ name: '洗牙', category: 'SERVICE', price: amount, quantity: 1 }],
    }, context);
    await chargeService.pay(String(charge.id), amount, method, undefined, context);
    return String(charge.id);
  }

  async function createCardWithBalance(balance: number): Promise<string> {
    // 同一患者仅保留一张活跃卡，避免 pay(MEMBER_CARD) 按 findByPatient LIMIT 1 选错卡
    db.prepare('UPDATE MemberCard SET deletedAt = ? WHERE patientId = ? AND deletedAt IS NULL')
      .run(now, 'patient-demo-001');
    const memberCardService = new MemberCardService(db);
    const cardNo = `RF-CARD-${balance}-${Math.random().toString(36).slice(2, 8)}`;
    const card = memberCardService.create({
      patientId: 'patient-demo-001',
      cardNo,
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context);
    await memberCardService.recharge(String(card.id), balance, context);
    return String(card.id);
  }

  it('链1：会员卡退款走通 申请→审批通过→确认退款，资金状态保持', async () => {
    const chargeService = new ChargeService(db);

    const cardId = await createCardWithBalance(10000);
    const chargeId = await createPaidCharge(10000, 'MEMBER_CARD');
    const card = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(cardId) as { balance: number };
    expect(card.balance).toBe(0);

    const refundResult = await chargeService.refund(chargeId, 5000, '会员卡退款测试', context);
    const refundId = String(refundResult.id);
    const requestRow = db.prepare('SELECT * FROM Refund WHERE id = ?').get(refundId) as Record<string, unknown>;
    expect(requestRow.status).toBe('REQUESTED');
    expect(requestRow.amount).toBe(5000);
    expect(requestRow.operatorId).toBe('user-admin-001');
    const requestedCharge = db.prepare('SELECT * FROM Charge WHERE id = ?').get(chargeId) as Record<string, unknown>;
    expect(requestedCharge.refundedAmount).toBe(5000);
    const creditedCard = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(cardId) as { balance: number };
    expect(creditedCard.balance).toBe(5000);

    const service = new RefundFlowService(db);
    const approveResult = service.approve(refundId, context);
    expect(approveResult).toEqual({ id: refundId, status: 'PENDING_REFUND', approvedAt: now });
    const approvedRow = db.prepare('SELECT * FROM Refund WHERE id = ?').get(refundId) as Record<string, unknown>;
    expect(approvedRow.status).toBe('PENDING_REFUND');
    expect(approvedRow.approvedById).toBe('user-admin-001');
    expect(approvedRow.approvedAt).toBe(now);

    const processResult = service.process(refundId, context);
    expect(processResult).toEqual({ id: refundId, status: 'COMPLETED', processedAt: now });
    const processedRow = db.prepare('SELECT * FROM Refund WHERE id = ?').get(refundId) as Record<string, unknown>;
    expect(processedRow.status).toBe('COMPLETED');
    expect(processedRow.processedById).toBe('user-admin-001');
    expect(processedRow.processedAt).toBe(now);
    const processedCharge = db.prepare('SELECT * FROM Charge WHERE id = ?').get(chargeId) as Record<string, unknown>;
    expect(processedCharge.refundedAmount).toBe(5000); // 确认退款不再变动资金
    expect(processedCharge.status).toBe('PAID');
  });

  it('链2：现金退款被驳回后 Charge.refundedAmount 回滚为 0、状态回到 PAID', async () => {
    const chargeService = new ChargeService(db);
    const chargeId = await createPaidCharge(10000, 'CASH');
    const refundResult = await chargeService.refund(chargeId, 3000, '多收退款', context);
    const refundId = String(refundResult.id);
    const beforeReject = db.prepare('SELECT * FROM Charge WHERE id = ?').get(chargeId) as Record<string, unknown>;
    expect(beforeReject.refundedAmount).toBe(3000);
    expect(beforeReject.status).toBe('PAID');

    const service = new RefundFlowService(db);
    const rejectResult = service.reject(refundId, context);
    expect(rejectResult).toEqual({ id: refundId, status: 'REJECTED' });
    const rejectedRow = db.prepare('SELECT * FROM Refund WHERE id = ?').get(refundId) as Record<string, unknown>;
    expect(rejectedRow.status).toBe('REJECTED');
    expect(rejectedRow.approvedById).toBe('user-admin-001');
    expect(rejectedRow.approvedAt).toBe(now);
    const charge = db.prepare('SELECT * FROM Charge WHERE id = ?').get(chargeId) as Record<string, unknown>;
    expect(charge.refundedAmount).toBe(0);
    expect(charge.status).toBe('PAID');
  });

  it('链3：会员卡退款被驳回后余额回滚并记录 REFUND_REVERSAL', async () => {
    const chargeService = new ChargeService(db);
    const cardId = await createCardWithBalance(10000);
    const chargeId = await createPaidCharge(10000, 'MEMBER_CARD');
    const refundResult = await chargeService.refund(chargeId, 4000, '会员卡退款驳回测试', context);
    const refundId = String(refundResult.id);
    const credited = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(cardId) as { balance: number };
    expect(credited.balance).toBe(4000);

    const service = new RefundFlowService(db);
    expect(service.reject(refundId, context)).toEqual({ id: refundId, status: 'REJECTED' });
    const rolledBack = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(cardId) as { balance: number };
    expect(rolledBack.balance).toBe(0);
    const reversalLog = db.prepare(
      `SELECT * FROM MemberCardLog WHERE cardId = ? AND type = 'REFUND_REVERSAL' ORDER BY createdAt DESC LIMIT 1`,
    ).get(cardId) as Record<string, unknown>;
    expect(reversalLog).toBeDefined();
    expect(reversalLog.amount).toBe(-4000);
    expect(reversalLog.balanceAfter).toBe(0);
    expect(reversalLog.remark).toBe('退款驳回/取消回滚');
  });

  it('链3b：多卡场景驳回冲销按原支付卡扣回，不再误扣第一张 ACTIVE 卡', async () => {
    const chargeService = new ChargeService(db);
    const memberCardService = new MemberCardService(db);
    db.prepare('UPDATE MemberCard SET deletedAt = ? WHERE patientId = ? AND deletedAt IS NULL')
      .run(now, 'patient-demo-001');
    const cardA = memberCardService.create({
      patientId: 'patient-demo-001',
      cardNo: `RF-CARD-A-${Math.random().toString(36).slice(2, 8)}`,
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context);
    await memberCardService.recharge(String(cardA.id), 10000, context);
    const cardB = memberCardService.create({
      patientId: 'patient-demo-001',
      cardNo: `RF-CARD-B-${Math.random().toString(36).slice(2, 8)}`,
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context);
    await memberCardService.recharge(String(cardB.id), 10000, context);

    // 先冻结卡A，确保支付落到卡B（Charge.memberCardId = B）
    db.prepare('UPDATE MemberCard SET status = ? WHERE id = ?').run('FROZEN', cardA.id);
    const chargeId = await createPaidCharge(10000, 'MEMBER_CARD');
    const chargeRow = db.prepare('SELECT memberCardId FROM Charge WHERE id = ?').get(chargeId) as { memberCardId: string | null };
    expect(chargeRow.memberCardId).toBe(String(cardB.id));
    // 恢复卡A为 ACTIVE，制造旧实现会误选"第一张 ACTIVE 卡=A"的场景
    db.prepare('UPDATE MemberCard SET status = ? WHERE id = ?').run('ACTIVE', cardA.id);

    const refundResult = await chargeService.refund(chargeId, 4000, '多卡驳回测试', context);
    const refundId = String(refundResult.id);
    const service = new RefundFlowService(db);
    expect(service.reject(refundId, context)).toEqual({ id: refundId, status: 'REJECTED' });

    const balanceA = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(String(cardA.id)) as { balance: number };
    const balanceB = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(String(cardB.id)) as { balance: number };
    expect(balanceA.balance).toBe(10000); // 未动卡A
    expect(balanceB.balance).toBe(0); // 原支付卡B：退款回充 4000 后驳回扣回 4000
    const reversalLog = db.prepare(
      `SELECT * FROM MemberCardLog WHERE cardId = ? AND type = 'REFUND_REVERSAL' ORDER BY createdAt DESC LIMIT 1`,
    ).get(String(cardB.id)) as Record<string, unknown>;
    expect(reversalLog).toBeDefined();
    expect(reversalLog.amount).toBe(-4000);
  });

  it('链4：现金退款被取消后资金同样回滚', async () => {
    const chargeService = new ChargeService(db);
    const chargeId = await createPaidCharge(10000, 'CASH');
    const refundResult = await chargeService.refund(chargeId, 2000, '患者取消', context);
    const refundId = String(refundResult.id);

    const service = new RefundFlowService(db);
    const cancelResult = service.cancel(refundId, context);
    expect(cancelResult).toEqual({ id: refundId, status: 'CANCELLED' });
    const cancelledRow = db.prepare('SELECT * FROM Refund WHERE id = ?').get(refundId) as Record<string, unknown>;
    expect(cancelledRow.status).toBe('CANCELLED');
    const charge = db.prepare('SELECT * FROM Charge WHERE id = ?').get(chargeId) as Record<string, unknown>;
    expect(charge.refundedAmount).toBe(0);
    expect(charge.status).toBe('PAID');
  });

  it('收费单已删除时驳回仅更新退款状态、不抛错', async () => {
    const chargeService = new ChargeService(db);
    const chargeId = await createPaidCharge(10000, 'CASH');
    const refundResult = await chargeService.refund(chargeId, 1000, '删单测试', context);
    const refundId = String(refundResult.id);
    db.prepare('UPDATE Charge SET deletedAt = ? WHERE id = ?').run(now, chargeId);

    const service = new RefundFlowService(db);
    expect(service.reject(refundId, context)).toEqual({ id: refundId, status: 'REJECTED' });
    const row = db.prepare('SELECT status FROM Refund WHERE id = ?').get(refundId) as { status: string };
    expect(row.status).toBe('REJECTED');
  });

  it('状态机：非 REQUESTED 记录不可审批/驳回/取消，非 PENDING_REFUND 不可确认完成', async () => {
    const chargeService = new ChargeService(db);
    const chargeId = await createPaidCharge(10000, 'CASH');
    const refundResult = await chargeService.refund(chargeId, 1000, '状态机测试', context);
    const refundId = String(refundResult.id);
    const service = new RefundFlowService(db);

    service.approve(refundId, context);
    service.process(refundId, context);

    expect(() => service.approve(refundId, context)).toThrow(ConflictError);
    expect(() => service.approve(refundId, context)).toThrow('仅待审核的退款可审批通过');
    expect(() => service.reject(refundId, context)).toThrow('仅待审核的退款可驳回');
    expect(() => service.cancel(refundId, context)).toThrow('仅待审核的退款可取消');
    expect(() => service.process(refundId, context)).toThrow('仅待退款的记录可确认完成');
  });

  it('状态机：REQUESTED 不可直接确认退款', async () => {
    const chargeService = new ChargeService(db);
    const chargeId = await createPaidCharge(10000, 'CASH');
    const refundResult = await chargeService.refund(chargeId, 1000, '状态机测试2', context);
    const refundId = String(refundResult.id);
    const service = new RefundFlowService(db);
    expect(() => service.process(refundId, context)).toThrow(ConflictError);
    expect(() => service.process(refundId, context)).toThrow('仅待退款的记录可确认完成');
  });

  it('不存在的退款返回 NotFoundError', () => {
    const service = new RefundFlowService(db);
    expect(() => service.approve('missing-refund', context)).toThrow(NotFoundError);
    expect(() => service.approve('missing-refund', context)).toThrow('Refund not found');
    expect(() => service.process('missing-refund', context)).toThrow(NotFoundError);
    expect(() => service.reject('missing-refund', context)).toThrow(NotFoundError);
    expect(() => service.cancel('missing-refund', context)).toThrow(NotFoundError);
  });

  it('list 返回患者/收费单联表字段，且按租户隔离', async () => {
    const chargeService = new ChargeService(db);
    const chargeId = await createPaidCharge(10000, 'CASH');
    const refundResult = await chargeService.refund(chargeId, 1500, '列表测试', context);
    const refundId = String(refundResult.id);

    // 其他诊所的退款：可见性隔离
    db.prepare(
      `INSERT INTO Refund (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, amount, reason, operatorId
       ) VALUES (?, 'clinic-other', ?, ?, NULL, ?, 'patient-demo-001', 900, '其他诊所', 'user-admin-001')`,
    ).run('refund-other-clinic', now, now, chargeId);

    const service = new RefundFlowService(db);
    const rows = service.list(context);
    expect(rows.length).toBeGreaterThan(0);
    const mine = rows.find((row) => row.id === refundId) as Record<string, unknown>;
    expect(mine).toBeDefined();
    expect(mine.patientName).toBe('Demo Patient');
    expect(mine.patientId).toBe('patient-demo-001');
    expect(mine.chargeId).toBe(chargeId);
    expect(mine.chargeNumber).toBeTruthy();
    expect(mine.amount).toBe(1500);
    expect(mine.status).toBe('REQUESTED');
    expect(rows.some((row) => row.id === 'refund-other-clinic')).toBe(false);

    // 跨租户操作其他诊所的退款 → NotFound
    expect(() => service.approve('refund-other-clinic', context)).toThrow(NotFoundError);
  });
});
