 
import { MedicalPhraseService, NO_PERMISSION } from './medical-phrase.service';
import { MedicalPhraseScope, MedicalPhraseSort } from './dto/list-medical-phrase.dto';
import { BusinessValidationException } from '@common/errors';
import { NotFoundException } from '@nestjs/common';
import { asDbService, MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';

const TEST_CLINIC = 'test-clinic-001';
const USER_ME = 'test-user-001';
const USER_OTHER = 'test-user-999';

function createMockClinicContext(
  clinicId: string | null = TEST_CLINIC,
  userId: string | null = USER_ME,
  role: string = 'DOCTOR',
): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => userId,
    getRole: () => role,
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockSettingsService(overrides: Record<string, string> = {}): SettingsService {
  const defaults: Record<string, string> = {
    aiMedicalPhraseRecommendEnabled: 'true',
    ...overrides,
  };
  return {
    get: async (key: string) => defaults[key],
    getBoolean: async (key: string, defaultValue = false) => {
      const v = defaults[key];
      if (v == undefined) return defaultValue;
      return v === 'true' || v === '1' || v === 'yes';
    },
    getNumber: async (key: string, defaultValue = 0) => {
      const v = defaults[key];
      return v == undefined ? defaultValue : Number(v);
    },
    getClinicInfo: async () => ({ ...defaults }),
    updateClinicInfo: async () => {},
  } as unknown as SettingsService;
}

function phraseSeed(
  id: string,
  overrides: Partial<{
    name: string;
    category: string;
    content: string;
    isPublic: number;
    ownerId: string | null;
    pinOrder: number;
    useCount: number;
    triggerToothStatuses: string[];
    triggerToothConditions: string[];
    lastUsedAt: string | null;
    copiedFromId: string | null;
    createdAt: string;
    deletedAt: string | null;
  }> = {},
): Record<string, unknown> {
  return {
    id,
    name: overrides.name ?? `Phrase ${id}`,
    category: overrides.category ?? 'General',
    content: overrides.content ?? `Content for ${id}`,
    isPublic: overrides.isPublic ?? 1,
    creatorId: USER_ME,
    ownerId: overrides.ownerId ?? null,
    pinOrder: overrides.pinOrder ?? 0,
    clinicId: TEST_CLINIC,
    useCount: overrides.useCount ?? 0,
    triggerToothStatuses: JSON.stringify(overrides.triggerToothStatuses ?? []),
    triggerToothConditions: JSON.stringify(overrides.triggerToothConditions ?? []),
    lastUsedAt: overrides.lastUsedAt ?? null,
    copiedFromId: overrides.copiedFromId ?? null,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: overrides.deletedAt ?? null,
  };
}

function toothSeed(
  id: string,
  patientId: string,
  toothNumber: number,
  currentStatus: string,
  conditions: string[] = [],
): Record<string, unknown> {
  return {
    id,
    patientId,
    toothNumber,
    currentStatus,
    conditions: JSON.stringify(conditions),
    remark: null,
    clinicId: TEST_CLINIC,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

describe('MedicalPhraseService', () => {
  let service: MedicalPhraseService;
  let db: MockDbService;

  const setupService = (
    clinicCtx: ClinicContextService = createMockClinicContext(),
    settings: SettingsService = createMockSettingsService(),
  ) => {
    db = new MockDbService();
    service = new MedicalPhraseService(asDbService(db), clinicCtx, settings);
    return { service, db };
  };

  beforeEach(() => setupService());

  afterEach(() => db?.clear());

  const seedDefaultPhrases = () => {
    const phrases = [
      { name: '龋洞充填', statuses: ['DECAYED', 'CROWN_FRACTURED'], conds: ['DECAY', 'DECAY_SMOOTH', 'DECAY_PIT'], cat: '牙体牙髓' },
      { name: '牙髓炎 RCT', statuses: ['PULPITIS'], conds: ['PULPAL_PAIN'], cat: '牙体牙髓' },
      { name: '洁牙', statuses: ['CALCULUS', 'GINGIVITIS'], conds: ['PLAQUE', 'CALCULUS'], cat: '牙周' },
      { name: '牙周基础治疗', statuses: ['PERIODONTITIS'], conds: ['POCKET_DEPTH', 'MOBILITY'], cat: '牙周' },
      { name: '拔牙', statuses: ['NON_RESTORABLE', 'MOBILITY_III'], conds: ['MOBILITY'], cat: '口腔外科' },
      { name: '正畸初诊', statuses: ['MALOCCLUSION'], conds: [], cat: '正畸' },
      { name: '乳牙滞留拔除', statuses: [], conds: ['RETAINED_PRIMARY'], cat: '儿牙' },
      { name: '窝沟封闭', statuses: ['SOUND'], conds: [], cat: '儿牙' },
      { name: '固定修复（冠/桥）', statuses: ['ROOT_CANAL', 'CROWNED'], conds: ['CROWN'], cat: '修复' },
      { name: '可摘局部义齿', statuses: ['MISSING', 'EXTRACTED'], conds: ['EXTRACTION'], cat: '修复' },
      { name: '种植修复', statuses: ['MISSING', 'IMPLANT'], conds: ['IMPLANT'], cat: '种植' },
      { name: '外伤牙固定', statuses: ['CROWN_FRACTURED'], conds: [], cat: '口腔外科' },
    ];
    const rows = phrases.map((p, i) => phraseSeed(`def-${i + 1}`, {
      name: p.name, category: p.cat,
      isPublic: 1, ownerId: null,
      triggerToothStatuses: p.statuses,
      triggerToothConditions: p.conds,
    }));
    db.seed('MedicalRecordPhrase', rows);
  };

  // TR-4.1 list 无参数：默认 ALL + PIN_FIRST 返回含 12 条默认种子
  it('TR-4.1 list 默认 ALL + PIN_FIRST 返回 12 条默认种子', async () => {
    seedDefaultPhrases();
    const result = await service.list();
    expect(result.length).toBe(12);
    expect(result.map(r => r.name)).toContain('龋洞充填');
    expect(result.map(r => r.name)).toContain('牙髓炎 RCT');
  });

  // TR-4.2 createCustom 新建 → isPublic=false, ownerId=当前 user, useCount=0
  it('TR-4.2 createCustom 私有短语属性正确', async () => {
    const created = await service.createCustom({
      name: '我的自定义',
      category: 'General',
      content: '内容...',
    });
    expect(created).toBeDefined();
    expect(created.isPublic).toBe(0);
    expect(created.ownerId).toBe(USER_ME);
    expect(created.useCount).toBe(0);
    expect(Array.isArray(created.triggerToothStatuses)).toBe(true);
    expect(Array.isArray(created.triggerToothConditions)).toBe(true);
  });

  // TR-4.3 favorite 公共短语 → 克隆新 id，pinOrder=maxPin+1；再次 favorite 同一公共短语 → 不重复创建，仅移动 pinOrder
  it('TR-4.3 favorite 公共短语克隆+不重复创建仅移动 pin', async () => {
    db.seed('MedicalRecordPhrase', [
      phraseSeed('public-1', { name: '公共1', isPublic: 1, ownerId: null, pinOrder: 0 }),
      phraseSeed('my-private', { name: '我的', isPublic: 0, ownerId: USER_ME, pinOrder: 5 }),
    ]);
    const first = await service.favorite('public-1');
    expect(first.id).not.toBe('public-1');
    expect(first.ownerId).toBe(USER_ME);
    expect(first.copiedFromId).toBe('public-1');
    expect(first.pinOrder).toBe(6);

    const beforeCount = db.getTableData('MedicalRecordPhrase').filter(r => r.copiedFromId === 'public-1').length;
    const second = await service.favorite('public-1');
    const afterCount = db.getTableData('MedicalRecordPhrase').filter(r => r.copiedFromId === 'public-1').length;
    expect(afterCount).toBe(beforeCount);
    expect(second.pinOrder).toBeGreaterThan(5);
  });

  // TR-4.4 unfavorite 自己短语 → 软删除；别人短语 → 403
  it('TR-4.4 unfavorite 自己软删除他人403', async () => {
    db.seed('MedicalRecordPhrase', [
      phraseSeed('mine', { isPublic: 0, ownerId: USER_ME }),
      phraseSeed('other', { isPublic: 0, ownerId: USER_OTHER }),
    ]);
    await expect(service.unfavorite('mine')).resolves.not.toThrow();
    const mine = db.getTableData('MedicalRecordPhrase').find(r => r.id === 'mine');
    expect(mine?.deletedAt).not.toBeNull();

    await expect(service.unfavorite('other')).rejects.toThrow(BusinessValidationException);
    const other = db.getTableData('MedicalRecordPhrase').find(r => r.id === 'other');
    expect(other?.deletedAt).toBeNull();
  });

  // TR-4.5 reorderPin 6 条 → pin 顺序严格按输入；包含他人 id → 403 且无 DB 写（事务回滚）
  it('TR-4.5 reorderPin 批量正确；含他人 id 抛403且回滚', async () => {
    db.seed('MedicalRecordPhrase', [
      phraseSeed('p1', { isPublic: 0, ownerId: USER_ME, pinOrder: 1 }),
      phraseSeed('p2', { isPublic: 0, ownerId: USER_ME, pinOrder: 2 }),
      phraseSeed('p3', { isPublic: 0, ownerId: USER_ME, pinOrder: 3 }),
      phraseSeed('p4', { isPublic: 0, ownerId: USER_ME, pinOrder: 4 }),
      phraseSeed('p5', { isPublic: 0, ownerId: USER_ME, pinOrder: 5 }),
      phraseSeed('p6', { isPublic: 0, ownerId: USER_ME, pinOrder: 6 }),
      phraseSeed('other-p', { isPublic: 0, ownerId: USER_OTHER, pinOrder: 100 }),
    ]);

    const entries = [
      { phraseId: 'p1', order: 10 },
      { phraseId: 'p2', order: 20 },
      { phraseId: 'p3', order: 30 },
      { phraseId: 'p4', order: 40 },
      { phraseId: 'p5', order: 50 },
      { phraseId: 'p6', order: 60 },
    ];
    await service.reorderPin(entries);
    const table = db.getTableData('MedicalRecordPhrase');
    for (const e of entries) {
      const row = table.find(r => r.id === e.phraseId);
      expect(row?.pinOrder).toBe(e.order);
    }

    const badEntries = [...entries.slice(0, 2), { phraseId: 'other-p', order: 999 }];
    const originalOther = table.find(r => r.id === 'other-p')!.pinOrder;
    await expect(service.reorderPin(badEntries)).rejects.toThrow(NO_PERMISSION);
    expect(db.getTableData('MedicalRecordPhrase').find(r => r.id === 'other-p')?.pinOrder).toBe(originalOther);
  });

  // TR-4.6 incUseCount([id1,id2]) → 各自 useCount 从 0 变 1，再 1→2；lastUsedAt 非空且单调增
  it('TR-4.6 incUseCount 计数累加 lastUsedAt 递增', async () => {
    db.seed('MedicalRecordPhrase', [
      phraseSeed('id1', { isPublic: 0, ownerId: USER_ME, useCount: 0, lastUsedAt: null }),
      phraseSeed('id2', { isPublic: 0, ownerId: USER_ME, useCount: 0, lastUsedAt: null }),
    ]);
    await service.incUseCount(['id1', 'id2']);
    const t1 = db.getTableData('MedicalRecordPhrase');
    expect(t1.find(r => r.id === 'id1')?.useCount).toBe(1);
    expect(t1.find(r => r.id === 'id2')?.useCount).toBe(1);
    const firstStamp1 = t1.find(r => r.id === 'id1')?.lastUsedAt;
    const firstStamp2 = t1.find(r => r.id === 'id2')?.lastUsedAt;
    expect(firstStamp1).toBeTruthy();
    expect(firstStamp2).toBeTruthy();

    await new Promise(r => setTimeout(r, 5));
    await service.incUseCount(['id1', 'id2']);
    const t2 = db.getTableData('MedicalRecordPhrase');
    expect(t2.find(r => r.id === 'id1')?.useCount).toBe(2);
    expect(t2.find(r => r.id === 'id2')?.useCount).toBe(2);
    expect(new Date(t2.find(r => r.id === 'id1')?.lastUsedAt as string).getTime())
      .toBeGreaterThan(new Date(firstStamp1 as string).getTime());
  });

  // TR-4.7 recommendForTeeth：patient 有 26 DECAY, 16 PERIODONTITIS → 推荐"龋洞充填"+"牙周基础治疗"; matchReasons 各含具体牙位 (26 DECAY / 16 PERIODONTITIS)
  it('TR-4.7 recommendForTeeth 匹配 DECAY 及 PERIODONTITIS 带具体牙位原因', async () => {
    seedDefaultPhrases();
    const patientId = 'patient-1';
    db.seed('ToothRecord', [
      toothSeed('t26', patientId, 26, 'DECAYED', ['DECAY']),
      toothSeed('t16', patientId, 16, 'PERIODONTITIS', ['POCKET_DEPTH']),
    ]);
    const recs = await service.recommendForTeeth({ patientId });
    const names = recs.map(r => r.phrase.name);
    expect(names).toContain('龋洞充填');
    expect(names).toContain('牙周基础治疗');
    const qy = recs.find(r => r.phrase.name === '龋洞充填');
    expect(qy).toBeDefined();
    expect(qy!.matchReasons.some(r => r.startsWith('26'))).toBe(true);
    const yz = recs.find(r => r.phrase.name === '牙周基础治疗');
    expect(yz).toBeDefined();
    expect(yz!.matchReasons.some(r => r.startsWith('16'))).toBe(true);
  });

  // TR-4.8 recommendForTeeth 指定 toothNumbers=[26]，仅匹配 26；不包含 16
  it('TR-4.8 指定 toothNumbers=[26] 仅匹配 26', async () => {
    seedDefaultPhrases();
    const patientId = 'patient-1';
    db.seed('ToothRecord', [
      toothSeed('t26', patientId, 26, 'DECAYED', ['DECAY']),
      toothSeed('t16', patientId, 16, 'PERIODONTITIS', ['POCKET_DEPTH']),
    ]);
    const recs = await service.recommendForTeeth({ patientId, selectedToothNumbers: [26] });
    const names = recs.map(r => r.phrase.name);
    expect(names).toContain('龋洞充填');
    expect(names).not.toContain('牙周基础治疗');
  });

  // TR-4.9 未指定 toothNumbers → 自动取患者所有非 SOUND 牙齿匹配
  it('TR-4.9 未指定 toothNumbers 取所有非 SOUND 匹配', async () => {
    seedDefaultPhrases();
    const patientId = 'patient-1';
    db.seed('ToothRecord', [
      toothSeed('t11', patientId, 11, 'SOUND', []),
      toothSeed('t12', patientId, 12, 'SOUND', []),
      toothSeed('t26', patientId, 26, 'DECAYED', ['DECAY']),
      toothSeed('t16', patientId, 16, 'PERIODONTITIS', ['POCKET_DEPTH']),
    ]);
    const recs = await service.recommendForTeeth({ patientId });
    const names = recs.map(r => r.phrase.name);
    expect(names).toContain('龋洞充填');
    expect(names).toContain('牙周基础治疗');
    expect(names).not.toContain('窝沟封闭');
  });

  // TR-4.10 排序：PIN_FIRST 优先有 pinOrder=5 短语 > 0；HOT 排序 useCount DESC；RECENT lastUsedAt DESC
  it('TR-4.10 三种排序方式结果正确', async () => {
    db.seed('MedicalRecordPhrase', [
      phraseSeed('A', { isPublic: 1, ownerId: null, pinOrder: 5, useCount: 10, lastUsedAt: '2026-01-10', createdAt: '2026-01-01' }),
      phraseSeed('B', { isPublic: 1, ownerId: null, pinOrder: 0, useCount: 100, lastUsedAt: '2026-01-01', createdAt: '2026-01-05' }),
      phraseSeed('C', { isPublic: 1, ownerId: null, pinOrder: 0, useCount: 1, lastUsedAt: '2026-01-20', createdAt: '2026-01-10' }),
    ]);
    const pinFirst = await service.list({ scope: MedicalPhraseScope.PUBLIC, sort: MedicalPhraseSort.PIN_FIRST });
    expect(pinFirst[0].id).toBe('A');
    const hot = await service.list({ scope: MedicalPhraseScope.PUBLIC, sort: MedicalPhraseSort.HOT });
    expect(hot[0].id).toBe('B');
    const recent = await service.list({ scope: MedicalPhraseScope.PUBLIC, sort: MedicalPhraseSort.RECENT });
    expect(recent[0].id).toBe('C');
  });

  // TR-4.11 keyword='rct' 模糊 → 命中"牙髓炎 RCT"；keyword 空时不返回公共外
  it('TR-4.11 关键词模糊搜索', async () => {
    seedDefaultPhrases();
    const byRct = await service.list({ keyword: 'rct', scope: MedicalPhraseScope.ALL });
    expect(byRct.some(r => r.name === '牙髓炎 RCT')).toBe(true);

    const emptyKeyword = await service.list({ scope: MedicalPhraseScope.MINE });
    expect(emptyKeyword.some(r => r.isPublic === 1)).toBe(false);
  });

  // TR-4.12 迁移 v39：老数据库 ALTER 后 useCount 全部 0，JSON 列空数组；索引存在（通过 seedClinicDefaultPhrases 侧验证）
  it('TR-4.12 新字段 useCount/JSON 列默认值正确 + seed 前为空诊所幂等', async () => {
    const res1 = await service.seedClinicDefaultPhrases();
    expect(res1.inserted).toBe(12);
    const rows1 = db.getTableData('MedicalRecordPhrase');
    for (const row of rows1) {
      expect(row.useCount).toBe(0);
      expect(JSON.parse((row.triggerToothStatuses as string) ?? '[]')).toEqual(
        expect.any(Array)
      );
      expect(JSON.parse((row.triggerToothConditions as string) ?? '[]')).toEqual(
        expect.any(Array)
      );
    }
    const res2 = await service.seedClinicDefaultPhrases();
    expect(res2.inserted).toBe(0);
    const rows2 = db.getTableData('MedicalRecordPhrase');
    expect(rows2.length).toBe(12);
  });

  // TR-4.13 patch/update：ownerId=me 成功；他人 ownerId=other → 403 不改动
  it('TR-4.13 updatePhrase 本人成功他人403', async () => {
    db.seed('MedicalRecordPhrase', [
      phraseSeed('mine', { isPublic: 0, ownerId: USER_ME, name: 'old-name' }),
      phraseSeed('other', { isPublic: 0, ownerId: USER_OTHER, name: 'keep-name' }),
    ]);
    const ok = await service.updatePhrase('mine', { name: 'new-name' });
    expect(ok.name).toBe('new-name');
    await expect(service.updatePhrase('other', { name: 'hacked' })).rejects.toThrow(NO_PERMISSION);
    expect(db.getTableData('MedicalRecordPhrase').find(r => r.id === 'other')?.name).toBe('keep-name');
  });

  // TR-4.14 seedDefault：空诊所运行一次插入 12；运行两次不变（幂等）
  it('TR-4.14 seedDefault 幂等（12→再运行不变）', async () => {
    expect(db.getTableData('MedicalRecordPhrase').length).toBe(0);
    const r1 = await service.seedClinicDefaultPhrases();
    expect(r1.inserted).toBe(12);
    expect(db.getTableData('MedicalRecordPhrase').length).toBe(12);
    const r2 = await service.seedClinicDefaultPhrases();
    expect(r2.inserted).toBe(0);
    expect(db.getTableData('MedicalRecordPhrase').length).toBe(12);
  });

  // TR-4.15 triggerToothConditions 多值任一命中：conditions 有 POCKET_DEPTH 命中牙周基础
  it('TR-4.15 triggerConditions 任一命中即可', async () => {
    seedDefaultPhrases();
    const patientId = 'patient-1';
    db.seed('ToothRecord', [
      toothSeed('t16', patientId, 16, 'PERIODONTITIS', ['POCKET_DEPTH']),
    ]);
    const recs = await service.recommendForTeeth({ patientId });
    expect(recs.some(r => r.phrase.name === '牙周基础治疗')).toBe(true);
  });

  // TR-4.16 非法 toothNumber → ToothRecord upsert 抛 BusinessValidationException（已有，回归验证无效号）
  it('TR-4.16 非法 toothNumber 推荐参数直接抛 BusinessValidationException', async () => {
    await expect(service.recommendForTeeth({
      patientId: 'p1',
      selectedToothNumbers: [999],
    })).rejects.toThrow(BusinessValidationException);
  });

  // TR-4.17 selectedToothNumbers 含重复 id → dedupe；含非法 tooth 号 → 400
  it('TR-4.17 去重合法牙位号；非法直接 400', async () => {
    seedDefaultPhrases();
    const patientId = 'p1';
    db.seed('ToothRecord', [toothSeed('t-26-a', patientId, 26, 'DECAYED', ['DECAY'])]);
    const recs = await service.recommendForTeeth({
      patientId,
      selectedToothNumbers: [26, 26, 26],
    });
    expect(recs.some(r => r.phrase.name === '龋洞充填')).toBe(true);
    await expect(service.recommendForTeeth({
      patientId, selectedToothNumbers: [26, 0, 999],
    })).rejects.toThrow(BusinessValidationException);
  });

  // TR-4.18 scope=MINE：返回 only ownerId=me；scope=PUBLIC：仅 isPublic=1
  it('TR-4.18 scope MINE / PUBLIC 过滤准确', async () => {
    db.seed('MedicalRecordPhrase', [
      phraseSeed('public-p', { isPublic: 1, ownerId: null }),
      phraseSeed('mine-p', { isPublic: 0, ownerId: USER_ME }),
      phraseSeed('other-p', { isPublic: 0, ownerId: USER_OTHER }),
    ]);
    const mine = await service.list({ scope: MedicalPhraseScope.MINE });
    expect(mine.length).toBe(1);
    expect(mine[0].ownerId).toBe(USER_ME);

    const pub = await service.list({ scope: MedicalPhraseScope.PUBLIC });
    expect(pub.every(r => r.isPublic === 1)).toBe(true);
  });

  // TR-4.19 scope=ALL：个人+公共合并（相同 copiedFromId 只展示 favorited 我 own 不重复公共）
  it('TR-4.19 scope=ALL 合并并去重 copiedFromId 对应公共', async () => {
    db.seed('MedicalRecordPhrase', [
      phraseSeed('public-p', { name: '公共', isPublic: 1, ownerId: null }),
      phraseSeed('public-2', { name: '公共2', isPublic: 1, ownerId: null }),
      phraseSeed('mine-copy', { name: '我收藏的公共', isPublic: 0, ownerId: USER_ME, copiedFromId: 'public-p' }),
      phraseSeed('mine-orig', { name: '我原创', isPublic: 0, ownerId: USER_ME }),
    ]);
    const all = await service.list({ scope: MedicalPhraseScope.ALL });
    const ids = all.map(r => r.id);
    expect(ids).toContain('mine-copy');
    expect(ids).toContain('mine-orig');
    expect(ids).toContain('public-2');
    expect(ids).not.toContain('public-p');
  });

  // TR-4.20 recommendForTeeth 空患者无牙记录 → 返回 []，无异常；不崩溃
  it('TR-4.20 空患者无牙记录返回空数组不崩溃', async () => {
    seedDefaultPhrases();
    const recs = await service.recommendForTeeth({ patientId: 'not-exist-patient' });
    expect(recs).toEqual([]);
  });

  it('推荐开关关闭时 recommendForTeeth 返回 []', async () => {
    const ctx = createMockClinicContext();
    const settings = createMockSettingsService({ aiMedicalPhraseRecommendEnabled: 'false' });
    const svc = new MedicalPhraseService(asDbService(new MockDbService()), ctx, settings);
    expect(await svc.recommendForTeeth({ patientId: 'p' })).toEqual([]);
  });

  it('unfavorite 不存在 id NotFoundException', async () => {
    await expect(service.unfavorite('not-exist')).rejects.toThrow(NotFoundException);
  });

  it('favorite NotFoundException', async () => {
    await expect(service.favorite('not-exist')).rejects.toThrow(NotFoundException);
  });

  it('reorderPin 不存在 id NotFoundException', async () => {
    await expect(service.reorderPin([{ phraseId: 'nope', order: 1 }])).rejects.toThrow(NotFoundException);
  });

  it('createCustom trigger 字段可写入并读回数组', async () => {
    const created = await service.createCustom({
      name: '带 triggers',
      category: 'c',
      content: 'x',
      triggerToothStatuses: ['DECAYED'],
      triggerToothConditions: ['DECAY', 'CALCULUS'],
    });
    expect(created.triggerToothStatuses).toEqual(['DECAYED']);
    expect(created.triggerToothConditions).toEqual(['DECAY', 'CALCULUS']);
  });
});
