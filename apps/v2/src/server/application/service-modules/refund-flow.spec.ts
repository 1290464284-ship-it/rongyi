import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
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

  async function createCharge(total: number): Promise<string> {
    const chargeService = new ChargeService(db);
    const charge = await chargeService.create({
      patientId: 'patient-demo-001',
      items: [{ name: '综合治疗', category: 'SERVICE', price: total, quantity: 1 }],
    }, context);
    return String(charge.id);
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

  it('链5：混合支付（现金50+卡50）全额退款只回充卡 50，不再整单按 payMethod 回充', async () => {
    const chargeService = new ChargeService(db);
    const cardId = await createCardWithBalance(10000);
    const chargeId = await createCharge(10000);
    await chargeService.pay(chargeId, 5000, 'CASH', undefined, context);
    await chargeService.pay(chargeId, 5000, 'MEMBER_CARD', undefined, context);
    const chargeRow = db.prepare('SELECT payMethod, memberCardId FROM Charge WHERE id = ?').get(chargeId) as
      { payMethod: string | null; memberCardId: string | null };
    // COALESCE(?, payMethod) 由最后一次支付覆盖：payMethod='MEMBER_CARD'。
    // 旧代码因此整单按 MEMBER_CARD 回充 100（多回充 50）。
    expect(chargeRow.payMethod).toBe('MEMBER_CARD');
    expect(chargeRow.memberCardId).toBe(String(cardId));
    const afterPay = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(cardId) as { balance: number };
    expect(afterPay.balance).toBe(5000);

    const refundResult = await chargeService.refund(chargeId, 10000, '混合支付全额退款', context);
    const refundId = String(refundResult.id);
    expect(refundResult.status).toBe('REFUNDED');
    const credited = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(cardId) as { balance: number };
    expect(credited.balance).toBe(10000); // 只回充卡付的 50，现金 50 不回充

    // 流水账断言：1 条 PAY(MEMBER_CARD, 5000) + 1 条 REFUND(allocations=[{amount:5000}])
    const payRows = db.prepare(
      `SELECT * FROM PaymentLedger WHERE chargeId = ? AND type = 'PAY' ORDER BY createdAt, rowid`,
    ).all(chargeId) as Array<{ method: string; amount: number; reversedAmount: number }>;
    expect(payRows).toHaveLength(2);
    expect(payRows[0].method).toBe('CASH');
    expect(payRows[1].method).toBe('MEMBER_CARD');
    expect(payRows[1].reversedAmount).toBe(5000);
    const refundLedger = db.prepare(
      `SELECT * FROM PaymentLedger WHERE relatedId = ? AND type = 'REFUND'`,
    ).get(refundId) as { allocations: string; amount: number };
    expect(refundLedger.amount).toBe(10000);
    const allocations = JSON.parse(refundLedger.allocations) as Array<{ ledgerId: string; cardId: string; amount: number }>;
    expect(allocations).toHaveLength(1);
    expect(allocations[0].amount).toBe(5000);
    expect(allocations[0].cardId).toBe(String(cardId));
  });

  it('链6：多笔部分支付（卡50+卡50）全额退款逐笔 LIFO 冲销共 100', async () => {
    const chargeService = new ChargeService(db);
    const cardId = await createCardWithBalance(20000);
    const chargeId = await createCharge(10000);
    await chargeService.pay(chargeId, 5000, 'MEMBER_CARD', undefined, context);
    await chargeService.pay(chargeId, 5000, 'MEMBER_CARD', undefined, context);
    const afterPay = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(cardId) as { balance: number };
    expect(afterPay.balance).toBe(10000);

    const refundResult = await chargeService.refund(chargeId, 10000, '多笔部分支付退款', context);
    const credited = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(cardId) as { balance: number };
    expect(credited.balance).toBe(20000); // 两笔各回充 50，共 100
    expect(refundResult.status).toBe('REFUNDED');

    // 两笔 PAY 行 reversedAmount 各 5000
    const payRows = db.prepare(
      `SELECT * FROM PaymentLedger WHERE chargeId = ? AND type = 'PAY' AND deletedAt IS NULL ORDER BY createdAt, rowid`,
    ).all(chargeId) as Array<{ reversedAmount: number }>;
    expect(payRows).toHaveLength(2);
    expect(payRows.every((row) => row.reversedAmount === 5000)).toBe(true);
  });

  it('链7：混合支付退款被驳回后按 allocations 精确回滚（多卡只回原卡）', async () => {
    const chargeService = new ChargeService(db);
    const memberCardService = new MemberCardService(db);
    db.prepare('UPDATE MemberCard SET deletedAt = ? WHERE patientId = ? AND deletedAt IS NULL')
      .run(now, 'patient-demo-001');
    const cardA = memberCardService.create({
      patientId: 'patient-demo-001',
      cardNo: `RF-CARD-MIX-A-${Math.random().toString(36).slice(2, 8)}`,
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context);
    await memberCardService.recharge(String(cardA.id), 10000, context);
    const cardB = memberCardService.create({
      patientId: 'patient-demo-001',
      cardNo: `RF-CARD-MIX-B-${Math.random().toString(36).slice(2, 8)}`,
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context);
    await memberCardService.recharge(String(cardB.id), 10000, context);

    // 卡A 支付 50（此时 A 是查询到的卡）→ 冻结 A → 卡B 支付 50
    const chargeId = await createCharge(10000);
    await chargeService.pay(chargeId, 5000, 'MEMBER_CARD', undefined, context);
    const firstPay = db.prepare('SELECT cardId FROM PaymentLedger WHERE chargeId = ? AND type = \'PAY\' ORDER BY createdAt LIMIT 1').get(chargeId) as { cardId: string };
    expect(firstPay.cardId).toBe(String(cardA.id));
    db.prepare('UPDATE MemberCard SET status = ? WHERE id = ?').run('FROZEN', cardA.id);
    await chargeService.pay(chargeId, 5000, 'MEMBER_CARD', undefined, context);
    const secondPay = db.prepare('SELECT cardId FROM PaymentLedger WHERE chargeId = ? AND type = \'PAY\' ORDER BY createdAt DESC LIMIT 1').get(chargeId) as { cardId: string };
    expect(secondPay.cardId).toBe(String(cardB.id));

    const refundResult = await chargeService.refund(chargeId, 5000, '混合卡退款驳回', context);
    const refundId = String(refundResult.id);
    // 回充先冲销 LIFO：卡B +5000（5000 → 10000）；卡A 未被触碰（5000）
    expect((db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(String(cardB.id)) as { balance: number }).balance).toBe(10000);

    const service = new RefundFlowService(db);
    expect(service.reject(refundId, context)).toEqual({ id: refundId, status: 'REJECTED' });
    // 驳回后卡B 精确扣回 5000；卡A 始终未被触碰（5000）
    expect((db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(String(cardA.id)) as { balance: number }).balance).toBe(5000);
    expect((db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(String(cardB.id)) as { balance: number }).balance).toBe(5000);
    // 流水冲销额度回滚
    const payRows = db.prepare(
      `SELECT cardId, reversedAmount FROM PaymentLedger WHERE chargeId = ? AND type = 'PAY' ORDER BY createdAt, rowid`,
    ).all(chargeId) as Array<{ cardId: string; reversedAmount: number }>;
    expect(payRows[0]).toEqual({ cardId: String(cardA.id), reversedAmount: 0 });
    expect(payRows[1]).toEqual({ cardId: String(cardB.id), reversedAmount: 0 });
  });

  it('链8：历史回填流水（ledger-backfill-）参与退款冲销且不超扣', async () => {
    const chargeService = new ChargeService(db);
    const cardId = await createCardWithBalance(10000);
    // 模拟迁移 146 回填的历史支付：不调用 pay()，直接插入 Charge + 回填流水
    const chargeId = await createCharge(10000);
    db.prepare(
      `UPDATE Charge SET paidAmount = 10000, payMethod = 'MEMBER_CARD', memberCardId = ?, status = 'PAID', paidAt = ?
       WHERE id = ?`,
    ).run(cardId, now, chargeId);
    db.prepare(
      `INSERT INTO PaymentLedger (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, type, method, amount, cardId, operatorId, reversedAmount, relatedId, allocations
       ) VALUES ('ledger-backfill-' || ?, ?, ?, ?, NULL, ?, 'patient-demo-001', 'PAY', 'MEMBER_CARD', 10000, ?, NULL, 0, NULL, NULL)`,
    ).run(chargeId, 'clinic-v2-001', now, now, chargeId, cardId);

    const refundResult = await chargeService.refund(chargeId, 10000, '历史单退款', context);
    expect(refundResult.status).toBe('REFUNDED');
    const credited = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(cardId) as { balance: number };
    expect(credited.balance).toBe(20000); // 回充上限 = paidAmount = 10000，不超扣
    const backfilled = db.prepare('SELECT reversedAmount FROM PaymentLedger WHERE id = ?').get(`ledger-backfill-${chargeId}`) as { reversedAmount: number };
    expect(backfilled.reversedAmount).toBe(10000);
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

  it('会员卡缺失时驳回会抛错并回滚退款状态，避免静默跳过冲销', async () => {
    const chargeService = new ChargeService(db);
    const cardId = await createCardWithBalance(10000);
    const chargeId = await createPaidCharge(10000, 'MEMBER_CARD');
    const refundResult = await chargeService.refund(chargeId, 4000, '缺卡回滚测试', context);
    const refundId = String(refundResult.id);
    db.prepare('UPDATE MemberCard SET deletedAt = ? WHERE id = ?').run(now, cardId);

    const service = new RefundFlowService(db);
    expect(() => service.reject(refundId, context)).toThrow(ConflictError);
    const row = db.prepare('SELECT status FROM Refund WHERE id = ?').get(refundId) as { status: string };
    expect(row.status).toBe('REQUESTED');
  });

  it('原支付卡缺失但患者还有其它卡时驳回抛错并保持 REQUESTED，不扣其它卡', async () => {
    const chargeService = new ChargeService(db);
    const memberCardService = new MemberCardService(db);
    db.prepare('UPDATE MemberCard SET deletedAt = ? WHERE patientId = ? AND deletedAt IS NULL')
      .run(now, 'patient-demo-001');
    const cardA = memberCardService.create({
      patientId: 'patient-demo-001',
      cardNo: `RF-CARD-STRICT-A-${Math.random().toString(36).slice(2, 8)}`,
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context);
    await memberCardService.recharge(String(cardA.id), 10000, context);
    const cardB = memberCardService.create({
      patientId: 'patient-demo-001',
      cardNo: `RF-CARD-STRICT-B-${Math.random().toString(36).slice(2, 8)}`,
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context);
    await memberCardService.recharge(String(cardB.id), 10000, context);
    db.prepare('UPDATE MemberCard SET status = ? WHERE id = ?').run('FROZEN', cardA.id);
    const chargeId = await createPaidCharge(10000, 'MEMBER_CARD');
    expect((db.prepare('SELECT memberCardId FROM Charge WHERE id = ?').get(chargeId) as { memberCardId: string }).memberCardId)
      .toBe(String(cardB.id));
    const refundResult = await chargeService.refund(chargeId, 4000, '缺原卡测试', context);
    const refundId = String(refundResult.id);
    db.prepare('UPDATE MemberCard SET deletedAt = ? WHERE id = ?').run(now, cardB.id);

    const service = new RefundFlowService(db);
    expect(() => service.reject(refundId, context)).toThrow(ConflictError);
    const row = db.prepare('SELECT status FROM Refund WHERE id = ?').get(refundId) as { status: string };
    expect(row.status).toBe('REQUESTED');
    const balanceA = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(String(cardA.id)) as { balance: number };
    expect(balanceA.balance).toBe(10000);
  });

  it('退款冲销 allocations 损坏时驳回抛错并保持 REQUESTED，不静默跳过', async () => {
    const chargeService = new ChargeService(db);
    const cardId = await createCardWithBalance(10000);
    const chargeId = await createPaidCharge(10000, 'MEMBER_CARD');
    const refundResult = await chargeService.refund(chargeId, 4000, '损坏分配测试', context);
    const refundId = String(refundResult.id);
    db.prepare("UPDATE PaymentLedger SET allocations = 'not-json' WHERE relatedId = ? AND type = 'REFUND'")
      .run(refundId);

    const service = new RefundFlowService(db);
    expect(() => service.reject(refundId, context)).toThrow(ConflictError);
    const row = db.prepare('SELECT status FROM Refund WHERE id = ?').get(refundId) as { status: string };
    expect(row.status).toBe('REQUESTED');
    const balance = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(cardId) as { balance: number };
    expect(balance.balance).toBe(4000);
  });

  it('旧退款（无 REFUND 流水）驳回时同步回退 PAY 流水 reversedAmount', async () => {
    const chargeService = new ChargeService(db);
    await createCardWithBalance(10000);
    const chargeId = await createPaidCharge(10000, 'MEMBER_CARD');
    const refundResult = await chargeService.refund(chargeId, 4000, '旧退款流水测试', context);
    const refundId = String(refundResult.id);
    db.prepare("UPDATE PaymentLedger SET allocations = NULL WHERE relatedId = ? AND type = 'REFUND'")
      .run(refundId);
    const payBefore = db.prepare(
      "SELECT reversedAmount FROM PaymentLedger WHERE chargeId = ? AND type = 'PAY' AND deletedAt IS NULL",
    ).get(chargeId) as { reversedAmount: number };
    expect(payBefore.reversedAmount).toBe(4000);

    const service = new RefundFlowService(db);
    expect(service.reject(refundId, context)).toEqual({ id: refundId, status: 'REJECTED' });
    const payAfter = db.prepare(
      "SELECT reversedAmount FROM PaymentLedger WHERE chargeId = ? AND type = 'PAY' AND deletedAt IS NULL",
    ).get(chargeId) as { reversedAmount: number };
    expect(payAfter.reversedAmount).toBe(0);
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

  it('链9：欠费单退款被驳回后 Debt.paidAmount 恢复并回到 PARTIAL', async () => {
    const chargeService = new ChargeService(db);
    const chargeId = await createCharge(10000);
    await chargeService.pay(chargeId, 3000, 'DEBT', undefined, context);

    const refundResult = await chargeService.refund(chargeId, 1000, '欠费部分退款驳回', context);
    const refundId = String(refundResult.id);
    const debtBefore = db.prepare('SELECT * FROM Debt WHERE chargeId = ?').get(chargeId) as Record<string, unknown>;
    expect(debtBefore.paidAmount).toBe(2000);
    expect(debtBefore.status).toBe('PARTIAL');

    const service = new RefundFlowService(db);
    expect(service.reject(refundId, context)).toEqual({ id: refundId, status: 'REJECTED' });
    const debtAfter = db.prepare('SELECT * FROM Debt WHERE chargeId = ?').get(chargeId) as Record<string, unknown>;
    expect(debtAfter.paidAmount).toBe(3000);
    expect(debtAfter.status).toBe('PARTIAL');
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

  it('validates refund list pagination', () => {
    const service = new RefundFlowService(db);
    expect(() => service.list(context, { page: 0 })).toThrow(ValidationError);
    expect(() => service.list(context, { pageSize: 0 })).toThrow(ValidationError);
  });

  it('rejects approve and process when optimistic status updates change zero rows', async () => {
    const chargeId = await createPaidCharge(100, 'CASH');
    db.prepare(
      `INSERT INTO Refund (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, amount, status, operatorId, reason
       ) VALUES ('refund-race', 'clinic-v2-001', ?, ?, NULL, ?, 'patient-demo-001', 100, 'REQUESTED', 'user-admin-001', 'race')`,
    ).run(now, now, chargeId);
    const service = new RefundFlowService(db);
    const originalPrepare = db.prepare.bind(db);

    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes("SET status = 'PENDING_REFUND'")) return { run: () => ({ changes: 0 }) } as never;
      return originalPrepare(sql);
    });
    expect(() => service.approve('refund-race', context)).toThrow(ConflictError);
    vi.restoreAllMocks();

    db.prepare("UPDATE Refund SET status = 'PENDING_REFUND' WHERE id = 'refund-race'").run();
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes("SET status = 'COMPLETED'")) return { run: () => ({ changes: 0 }) } as never;
      return originalPrepare(sql);
    });
    expect(() => service.process('refund-race', context)).toThrow(ConflictError);
    vi.restoreAllMocks();
  });
});
