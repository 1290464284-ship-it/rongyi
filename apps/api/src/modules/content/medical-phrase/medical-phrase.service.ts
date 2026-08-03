import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessValidationException } from '@common/errors';
import { BaseService } from '../../../common/services/base.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { DbService } from '../../../db/db.service';
import { IDatabase } from '../../../db/db.interface';
import { ToothStatus, ToothCondition, BaseEntity, Role } from '@dental/shared';
import { AuditLogType } from '../../../common/constants/audit-log-types';
import { MedicalPhraseScope, MedicalPhraseSort } from './dto/list-medical-phrase.dto';
import { CreateMedicalPhraseDto } from './dto/create-medical-phrase.dto';
import { UpdateMedicalPhraseDto } from './dto/update-medical-phrase.dto';
import { PinOrderEntryDto } from './dto/reorder-pin.dto';
import { SettingsService } from '../../system/settings/settings.service';
import * as crypto from 'node:crypto';

export interface MedicalRecordPhraseEntity extends BaseEntity {
  id: string;
  name: string;
  category?: string;
  content: string;
  isPublic: number;
  creatorId?: string;
  ownerId?: string;
  pinOrder: number;
  clinicId: string;
  useCount: number;
  triggerToothStatuses: string[];
  triggerToothConditions: string[];
  lastUsedAt?: string;
  copiedFromId?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecommendResult {
  phrase: MedicalRecordPhraseEntity;
  matchReasons: string[];
}

interface ListOptions {
  category?: string;
  keyword?: string;
  scope?: MedicalPhraseScope;
  sort?: MedicalPhraseSort;
}

export const NO_PERMISSION = 'NO_PERMISSION';

const DEFAULT_PHRASES: Array<{
  name: string;
  category: string;
  content: string;
  triggerStatuses: string[];
  triggerConditions: string[];
}> = [
  {
    name: '龋洞充填',
    category: '牙体牙髓',
    content: '去除腐质，备洞，酸蚀，冲洗，吹干，涂布粘结剂，光照固化，复合树脂分层充填，调合，抛光。',
    triggerStatuses: [ToothStatus.DECAYED, 'CROWN_FRACTURED'],
    triggerConditions: [ToothCondition.DECAY, 'DECAY_SMOOTH', 'DECAY_PIT'],
  },
  {
    name: '牙髓炎 RCT',
    category: '牙体牙髓',
    content: '局麻下开髓，去除冠髓，拔髓，测量工作长度，根管预备（冠向下法），次氯酸钠+EDTA 冲洗，吸干，封氢氧化钙糊剂，暂封。复诊：去除暂封，冲洗吸干，AH-Plus 糊剂+牙胶尖冷侧压充填，垫底，树脂充填。',
    triggerStatuses: ['PULPITIS'],
    triggerConditions: ['PULPAL_PAIN'],
  },
  {
    name: '洁牙',
    category: '牙周',
    content: '全口超声洁治+手工刮治，去除牙结石及菌斑，抛光，冲洗，涂布碘甘油。口腔卫生宣教：巴氏刷牙法，牙线/间隙刷使用。',
    triggerStatuses: ['CALCULUS', 'GINGIVITIS'],
    triggerConditions: [ToothCondition.CALCULUS, ToothCondition.BLEEDING, 'PLAQUE'],
  },
  {
    name: '牙周基础治疗',
    category: '牙周',
    content: '全口口腔卫生评估，分区段行超声洁治+龈下刮治根面平整（SRP），必要时局麻，牙周袋内涂布派丽奥/米诺环素凝胶。口腔卫生强化指导，4-6 周复查评估再治疗需求。',
    triggerStatuses: ['PERIODONTITIS'],
    triggerConditions: [ToothCondition.FURCATION, ToothCondition.MOBILITY, 'POCKET_DEPTH'],
  },
  {
    name: '拔牙',
    category: '口腔外科',
    content: '术区消毒，局部浸润/阻滞麻醉生效后，分离牙龈，牙挺松患牙，牙钳拔除，搔刮牙槽窝，复位牙槽嵴，压迫止血。术后医嘱：棉球咬合 30-60 分钟，24h 不漱口不刷牙，温凉软食，避免患侧咀嚼，出血多/发热随诊。必要时口服抗生素+止痛药。',
    triggerStatuses: ['NON_RESTORABLE', 'MOBILITY_III', ToothStatus.EXTRACTED],
    triggerConditions: [ToothCondition.MOBILITY],
  },
  {
    name: '正畸初诊',
    category: '正畸',
    content: '患者主诉及矫治诉求确认，面型分析（直面/凸面/凹面，对称），口内检查：咬合关系（Angle 分类），牙列拥挤/间隙，覆合覆盖，中线，牙周状况。拍摄全景片+头颅侧位片+口内像+面像，取寄存模型，数字化扫描。待下次出矫治方案。',
    triggerStatuses: ['MALOCCLUSION'],
    triggerConditions: [],
  },
  {
    name: '乳牙滞留拔除',
    category: '儿牙',
    content: '术前解释安抚，表面麻醉涂布，局麻下分离牙龈，牙钳拔除乳牙，搔刮乳牙窝（勿伤恒牙胚），棉球止血。术后医嘱：咬合棉球 20 分钟，当天不漱口，软食，1-3 月观察恒牙萌出位置，如异位萌出及时复诊。',
    triggerStatuses: [],
    triggerConditions: ['RETAINED_PRIMARY'],
  },
  {
    name: '窝沟封闭',
    category: '儿牙',
    content: '清洁牙面，酸蚀（恒磨牙 30s，乳磨牙 60s），冲洗吹干（白垩色），涂布封闭剂，光照固化 20-40s，调合检查。3/6 月复查脱落情况再补。',
    triggerStatuses: [ToothStatus.SOUND],
    triggerConditions: [],
  },
  {
    name: '固定修复（冠/桥）',
    category: '修复',
    content: '患牙牙体预备（轴壁聚合度 2-5°，肩台 1mm，咬合间隙 1.5-2mm），排龈，精细印模（硅橡胶双重印模），临时冠制作及粘接，比色记录。嘱勿食硬物，敏感随诊，复诊戴牙。',
    triggerStatuses: [ToothStatus.ROOT_CANAL, ToothStatus.CROWNED, 'CROWN_FRACTURED'],
    triggerConditions: [ToothCondition.CROWN],
  },
  {
    name: '可摘局部义齿',
    category: '修复',
    content: '口腔检查：余留牙、缺牙间隙、牙槽嵴、咬合关系，取初印模，灌注工作模型，咬合记录，上架，试排牙，复诊试戴，调合，戴牙后医嘱：初戴异物感，发音不清，1-2 周适应，饭后取出清洗，夜间不戴，浸泡冷水中，压痛及时复诊调磨。',
    triggerStatuses: [ToothStatus.MISSING, ToothStatus.EXTRACTED],
    triggerConditions: [ToothCondition.EXTRACTION],
  },
  {
    name: '种植修复',
    category: '种植',
    content: 'CBCT 检查骨量骨密度评估，术区消毒，局麻下切开翻瓣，逐级备洞，植入种植体，扭力达标，安装愈合基台/埋入式，严密缝合。术后医嘱：冷敷 24h，温凉软食，抗生素+漱口水+止痛药，7-10 天拆线。3-6 月后二期修复取模戴冠。',
    triggerStatuses: [ToothStatus.MISSING, ToothStatus.IMPLANT],
    triggerConditions: [ToothCondition.IMPLANT],
  },
  {
    name: '外伤牙固定',
    category: '口腔外科',
    content: '术前 CBCT 确认牙根折/牙槽突折情况，患牙（及邻牙）轻柔手法复位至正常咬合，酸蚀牙面，流体树脂+正畸钢丝/纤维带粘接固定 2-4 周。调合避免早接触，软食 2 周，每月复查牙髓活力及吸收情况，必要时根管治疗。',
    triggerStatuses: ['CROWN_FRACTURED', 'ROOT_FRACTURED'],
    triggerConditions: [],
  },
];

function isValidToothNumber(n: number): boolean {
  return (n >= 11 && n <= 18) || (n >= 21 && n <= 28) || (n >= 31 && n <= 38) || (n >= 41 && n <= 48)
      || (n >= 51 && n <= 55) || (n >= 61 && n <= 65) || (n >= 71 && n <= 75) || (n >= 81 && n <= 85);
}

@Injectable()
export class MedicalPhraseService extends BaseService<MedicalRecordPhraseEntity> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private settingsService: SettingsService,
  ) {
    super(dbService, clinicContext, {
      tableName: 'MedicalRecordPhrase',
      jsonFields: ['triggerToothStatuses', 'triggerToothConditions'],
      searchFields: ['name', 'content'],
    });
  }

  private getMe(): { userId: string; role: string | null } {
    const userId = this.clinicContext.getUserId();
    if (!userId) throw new BusinessValidationException(NO_PERMISSION);
    return { userId, role: this.clinicContext.getRole() };
  }

  private isClinicAdmin(): boolean {
    const role = this.clinicContext.getRole();
    return role === Role.BOSS || role === Role.ADMIN;
  }

  async list(opts: ListOptions = {}): Promise<MedicalRecordPhraseEntity[]> {
    const { category, keyword, scope = MedicalPhraseScope.ALL, sort = MedicalPhraseSort.PIN_FIRST } = opts;
    const { userId } = this.getMe();
    const clinicId = this.clinicContext.getClinicId();
    const params: unknown[] = [];
    const conditions: string[] = ['deletedAt IS NULL'];

    if (clinicId) {
      conditions.push('clinicId = ?');
      params.push(clinicId);
    }

    switch (scope) {
      case MedicalPhraseScope.MINE:
        conditions.push('ownerId = ?');
        params.push(userId);
        break;
      case MedicalPhraseScope.PUBLIC:
        conditions.push('isPublic = ?');
        params.push(1);
        break;
      case MedicalPhraseScope.ALL:
      default:
        break;
    }

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    if (keyword) {
      conditions.push('(name LIKE ? ESCAPE \'\\\' OR content LIKE ? ESCAPE \'\\\')');
      const pattern = `%${keyword}%`;
      params.push(pattern, pattern);
    }

    const sql = `SELECT * FROM ${this.tableName} WHERE ${conditions.join(' AND ')}`;
    const rows = this.dbService.prepare(sql).all(...params) as MedicalRecordPhraseEntity[];
    this.parseJsonFields(rows);

    let filtered = rows;
    if (scope === MedicalPhraseScope.ALL) {
      const favoritedCopiedFromIds = new Set(
        rows.filter(r => r.ownerId === userId && r.copiedFromId).map(r => r.copiedFromId as string)
      );
      filtered = rows.filter(r => {
        if (r.ownerId === userId) return true;
        if (r.isPublic === 1 && favoritedCopiedFromIds.has(r.id)) return false;
        return r.isPublic === 1;
      });
    }

    switch (sort) {
      case MedicalPhraseSort.HOT:
        filtered = [...filtered].sort((a, b) => {
          const d = (b.useCount ?? 0) - (a.useCount ?? 0);
          if (d !== 0) return d;
          return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
        });
        break;
      case MedicalPhraseSort.RECENT:
        filtered = [...filtered].sort((a, b) => {
          const aNull = !a.lastUsedAt ? 1 : 0;
          const bNull = !b.lastUsedAt ? 1 : 0;
          if (aNull !== bNull) return aNull - bNull;
          if (a.lastUsedAt && b.lastUsedAt) {
            const d = b.lastUsedAt.localeCompare(a.lastUsedAt);
            if (d !== 0) return d;
          }
          return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
        });
        break;
      case MedicalPhraseSort.PIN_FIRST:
      default:
        filtered = [...filtered].sort((a, b) => {
          const p = (b.pinOrder ?? 0) - (a.pinOrder ?? 0);
          if (p !== 0) return p;
          const u = (b.useCount ?? 0) - (a.useCount ?? 0);
          if (u !== 0) return u;
          return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
        });
        break;
    }

    return filtered;
  }

  async favorite(phraseId: string): Promise<MedicalRecordPhraseEntity> {
    const { userId } = this.getMe();
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();

    const result = this.dbService.transaction((db: IDatabase) => {
      const original = db.prepare(
        `SELECT * FROM MedicalRecordPhrase WHERE id = ? AND deletedAt IS NULL`
      ).get(phraseId) as MedicalRecordPhraseEntity | undefined;

      if (!original) throw new NotFoundException('短语不存在');
      if (clinicId && original.clinicId !== clinicId) throw new NotFoundException('短语不存在');

      if (original.ownerId === userId) {
        return original;
      }

      const existingCopy = db.prepare(
        `SELECT * FROM MedicalRecordPhrase WHERE copiedFromId = ? AND ownerId = ? AND deletedAt IS NULL`
      ).get(phraseId, userId) as MedicalRecordPhraseEntity | undefined;

      const maxPinRow = db.prepare(
        `SELECT pinOrder FROM MedicalRecordPhrase WHERE ownerId = ? AND deletedAt IS NULL ORDER BY pinOrder DESC LIMIT 1`
      ).get(userId) as { pinOrder: number | null } | undefined;
      const maxPin = (maxPinRow && maxPinRow.pinOrder) ?? 0;
      const newPin = maxPin + 1;

      if (existingCopy) {
        db.prepare(
          `UPDATE MedicalRecordPhrase SET pinOrder = ?, updatedAt = ? WHERE id = ?`
        ).run(newPin, now, existingCopy.id);
        // soft-delete-exempt: 写后读取刚更新的记录，id 已确认存在且未删除
        const updated = db.prepare(
          `SELECT * FROM MedicalRecordPhrase WHERE id = ?`
        ).get(existingCopy.id) as MedicalRecordPhraseEntity;
        this.logAudit(db, AuditLogType.CONTENT_PHRASE_FAVORITE, existingCopy.id, 'MedicalRecordPhrase', {
          afterData: { pinOrder: newPin, from: phraseId, action: 'repin' },
        });
        return updated;
      }

      const newId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO MedicalRecordPhrase (id, name, category, content, isPublic, creatorId, ownerId, pinOrder, clinicId, useCount, triggerToothStatuses, triggerToothConditions, lastUsedAt, copiedFromId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId,
        original.name,
        original.category ?? null,
        original.content,
        0,
        original.creatorId ?? null,
        userId,
        newPin,
        clinicId ?? null,
        0,
        original.triggerToothStatuses ?? '[]',
        original.triggerToothConditions ?? '[]',
        null,
        phraseId,
        now,
        now,
      );

      this.logAudit(db, AuditLogType.CONTENT_PHRASE_FAVORITE, newId, 'MedicalRecordPhrase', {
        afterData: { copiedFromId: phraseId, pinOrder: newPin, action: 'clone' },
      });

      // soft-delete-exempt: 写后读取刚创建的记录，id 已确认存在且未删除
      return db.prepare(
        `SELECT * FROM MedicalRecordPhrase WHERE id = ?`
      ).get(newId) as MedicalRecordPhraseEntity;
    });

    this.parseJsonFields([result]);
    return result;
  }

  async unfavorite(phraseId: string): Promise<void> {
    const { userId } = this.getMe();
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();

    this.dbService.transaction((db: IDatabase) => {
      const existing = db.prepare(
        `SELECT * FROM MedicalRecordPhrase WHERE id = ? AND deletedAt IS NULL`
      ).get(phraseId) as MedicalRecordPhraseEntity | undefined;

      if (!existing) throw new NotFoundException('短语不存在');
      if (clinicId && existing.clinicId !== clinicId) throw new NotFoundException('短语不存在');

      if (existing.ownerId !== userId) {
        throw new BusinessValidationException(NO_PERMISSION);
      }

      db.prepare(
        `UPDATE MedicalRecordPhrase SET deletedAt = ?, updatedAt = ? WHERE id = ?`
      ).run(now, now, phraseId);

      this.logAudit(db, AuditLogType.CONTENT_PHRASE_UNFAVORITE, phraseId, 'MedicalRecordPhrase', {
        beforeData: { id: phraseId, name: existing.name },
      });
    });
  }

  async reorderPin(entries: PinOrderEntryDto[]): Promise<void> {
    const { userId } = this.getMe();
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    const phraseIds = entries.map(e => e.phraseId);

    this.dbService.transaction((db: IDatabase) => {
      const placeholders = phraseIds.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT id, ownerId FROM MedicalRecordPhrase WHERE id IN (${placeholders}) AND deletedAt IS NULL`
      ).all(...phraseIds) as Array<{ id: string; ownerId: string }>;

      const rowMap = new Map(rows.map(r => [r.id, r.ownerId]));
      for (const entry of entries) {
        const owner = rowMap.get(entry.phraseId);
        if (!owner) throw new NotFoundException('短语不存在');
        if (owner !== userId) throw new BusinessValidationException(NO_PERMISSION);
      }

      const updateStmt = db.prepare(
        `UPDATE MedicalRecordPhrase SET pinOrder = ?, updatedAt = ? WHERE id = ?`
      );
      for (const entry of entries) {
        updateStmt.run(entry.order, now, entry.phraseId);
      }

      this.logAudit(db, AuditLogType.CONTENT_PHRASE_REORDER, clinicId ?? '', 'MedicalRecordPhrase', {
        afterData: { entries: entries.map(e => ({ phraseId: e.phraseId, order: e.order })), count: entries.length },
      });
    });
  }

  async incUseCount(phraseIds: string[]): Promise<void> {
    if (phraseIds.length === 0) return;
    const uniqueIds = [...new Set(phraseIds)];
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();

    this.dbService.transaction((db: IDatabase) => {
      const stmt = db.prepare(
        `UPDATE MedicalRecordPhrase SET useCount = useCount + 1, lastUsedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL ${clinicId ? 'AND clinicId = ?' : ''}`
      );
      for (const id of uniqueIds) {
        if (clinicId) stmt.run(now, now, id, clinicId);
        else stmt.run(now, now, id);
      }
    });
  }

  async recommendForTeeth(ctx: {
    patientId: string;
    selectedToothNumbers?: number[];
    visit?: string;
  }): Promise<RecommendResult[]> {
    const enabled = this.settingsService
      ? await this.settingsService.getBoolean('aiMedicalPhraseRecommendEnabled', true)
      : true;
    if (!enabled) return [];
    const { patientId, selectedToothNumbers } = ctx;
    const clinicId = this.clinicContext.getClinicId();
    const { userId } = this.getMe();

    let targetNumbers: number[] = [];
    if (selectedToothNumbers && selectedToothNumbers.length > 0) {
      const deduped = [...new Set(selectedToothNumbers)];
      for (const n of deduped) {
        if (!isValidToothNumber(n)) throw new BusinessValidationException(`无效的牙位号: ${n}`);
      }
      targetNumbers = deduped;
    }

    const toothPlaceholders = targetNumbers.map(() => '?').join(', ');
    const toothParams: unknown[] = [...targetNumbers];

    const toothSql = `
      SELECT * FROM ToothRecord
      WHERE patientId = ?
        AND deletedAt IS NULL
        ${clinicId ? 'AND clinicId = ?' : ''}
        ${targetNumbers.length > 0 ? `AND toothNumber IN (${toothPlaceholders})` : ''}
    `;
    const sqlParams: unknown[] = [patientId];
    if (clinicId) sqlParams.push(clinicId);
    sqlParams.push(...toothParams);

    const allToothRecords = this.dbService.prepare(toothSql).all(...sqlParams) as Array<{
      id: string;
      patientId: string;
      toothNumber: number;
      currentStatus: string;
      conditions: string;
    }>;

    for (const r of allToothRecords) {
      try {
        (r as unknown as { conditions: string[] }).conditions = JSON.parse(r.conditions || '[]');
      } catch {
        (r as unknown as { conditions: string[] }).conditions = [];
      }
    }

    const nonSoundRecords = targetNumbers.length > 0
      ? allToothRecords
      : allToothRecords.filter(r => r.currentStatus !== ToothStatus.SOUND);

    if (nonSoundRecords.length === 0) return [];

    const phraseParams: unknown[] = [];
    const phraseFilters: string[] = ['deletedAt IS NULL'];
    if (clinicId) {
      phraseFilters.push('clinicId = ?');
      phraseParams.push(clinicId);
    }

    const phraseSql = `SELECT * FROM MedicalRecordPhrase WHERE ${phraseFilters.join(' AND ')}`;
    const allPhrases = this.dbService.prepare(phraseSql).all(...phraseParams) as MedicalRecordPhraseEntity[];
    this.parseJsonFields(allPhrases);
    const phrases = allPhrases.filter(p => p.ownerId === userId || p.isPublic === 1);
    phrases.sort((a, b) => {
      const p = (b.pinOrder ?? 0) - (a.pinOrder ?? 0);
      if (p !== 0) return p;
      const u = (b.useCount ?? 0) - (a.useCount ?? 0);
      if (u !== 0) return u;
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });

    const matchMap = new Map<string, { phrase: MedicalRecordPhraseEntity; reasons: string[]; matchCount: number }>();

    for (const phrase of phrases) {
      const triggerStatuses = new Set<string>(phrase.triggerToothStatuses);
      const triggerConds = new Set<string>(phrase.triggerToothConditions);
      if (triggerStatuses.size === 0 && triggerConds.size === 0) continue;

      const reasons: string[] = [];
      let matchCount = 0;

      for (const tooth of nonSoundRecords) {
        let matched = false;
        if (triggerStatuses.has(tooth.currentStatus)) {
          reasons.push(`${tooth.toothNumber} ${tooth.currentStatus}`);
          matched = true;
        }
        const toothConds = (tooth as unknown as { conditions: string[] }).conditions;
        for (const tc of toothConds) {
          if (triggerConds.has(tc)) {
            reasons.push(`${tooth.toothNumber} ${tc}`);
            matched = true;
          }
        }
        if (matched) matchCount++;
      }

      if (reasons.length > 0) {
        matchMap.set(phrase.id, { phrase, reasons: [...new Set(reasons)], matchCount });
      }
    }

    return Array.from(matchMap.values())
      .sort((a, b) => {
        const pinDiff = (b.phrase.pinOrder ?? 0) - (a.phrase.pinOrder ?? 0);
        if (pinDiff !== 0) return pinDiff;
        const weightDiff = b.matchCount - a.matchCount;
        if (weightDiff !== 0) return weightDiff;
        const useDiff = (b.phrase.useCount ?? 0) - (a.phrase.useCount ?? 0);
        if (useDiff !== 0) return useDiff;
        return 0;
      })
      .map(m => ({ phrase: m.phrase, matchReasons: m.reasons }));
  }

  async createCustom(data: CreateMedicalPhraseDto): Promise<MedicalRecordPhraseEntity> {
    const { userId } = this.getMe();
    const clinicId = this.clinicContext.getClinicId();

    const entity: Partial<MedicalRecordPhraseEntity> = {
      name: data.name,
      category: data.category,
      content: data.content,
      isPublic: 0,
      creatorId: userId,
      ownerId: userId,
      pinOrder: 0,
      clinicId: clinicId ?? undefined,
      useCount: 0,
      triggerToothStatuses: data.triggerToothStatuses ?? [],
      triggerToothConditions: data.triggerToothConditions ?? [],
    };

    const result = await this.create(entity);
    this.logAudit(this.dbService, AuditLogType.MEDICAL_RECORD_PHRASE_CREATE, result.id, 'MedicalRecordPhrase', {
      afterData: { name: data.name, category: data.category },
      operatorId: userId,
    });
    return result;
  }

  async updatePhrase(phraseId: string, patch: UpdateMedicalPhraseDto): Promise<MedicalRecordPhraseEntity> {
    const { userId } = this.getMe();
    const clinicId = this.clinicContext.getClinicId();

    const existing = this.dbService.prepare(
      `SELECT * FROM MedicalRecordPhrase WHERE id = ? AND deletedAt IS NULL`
    ).get(phraseId) as MedicalRecordPhraseEntity | undefined;

    if (!existing) throw new NotFoundException('短语不存在');
    if (clinicId && existing.clinicId !== clinicId) throw new NotFoundException('短语不存在');

    const isOwner = existing.ownerId === userId;
    if (!isOwner && !this.isClinicAdmin()) {
      throw new BusinessValidationException(NO_PERMISSION);
    }

    const safePatch: Partial<MedicalRecordPhraseEntity> = {};
    if (patch.name !== undefined) safePatch.name = patch.name;
    if (patch.category !== undefined) safePatch.category = patch.category;
    if (patch.content !== undefined) safePatch.content = patch.content;
    if (patch.pinOrder !== undefined) (safePatch as unknown as { pinOrder: number }).pinOrder = patch.pinOrder;
    if (patch.triggerToothStatuses !== undefined) (safePatch as unknown as { triggerToothStatuses: string[] }).triggerToothStatuses = patch.triggerToothStatuses;
    if (patch.triggerToothConditions !== undefined) (safePatch as unknown as { triggerToothConditions: string[] }).triggerToothConditions = patch.triggerToothConditions;

    const result = await this.update(phraseId, safePatch);
    this.logAudit(this.dbService, AuditLogType.MEDICAL_RECORD_PHRASE_UPDATE, phraseId, 'MedicalRecordPhrase', {
      beforeData: {
        name: existing.name,
        category: existing.category,
        content: existing.content,
        pinOrder: existing.pinOrder,
      },
      afterData: { ...safePatch },
      operatorId: userId,
    });
    return result;
  }

  async seedClinicDefaultPhrases(): Promise<{ inserted: number }> {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return { inserted: 0 };
    const { userId } = this.getMe();
    const now = new Date().toISOString();

    return this.dbService.transaction((db: IDatabase) => {
      const existing = db.prepare(
        `SELECT id FROM MedicalRecordPhrase WHERE clinicId = ? AND isPublic = 1 AND deletedAt IS NULL LIMIT 1`
      ).get(clinicId);
      if (existing) return { inserted: 0 };

      let count = 0;
      for (const p of DEFAULT_PHRASES) {
        const newId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO MedicalRecordPhrase (id, name, category, content, isPublic, creatorId, ownerId, pinOrder, clinicId, useCount, triggerToothStatuses, triggerToothConditions, lastUsedAt, copiedFromId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          newId,
          p.name,
          p.category,
          p.content,
          1,
          userId,
          null,
          0,
          clinicId,
          0,
          JSON.stringify(p.triggerStatuses),
          JSON.stringify(p.triggerConditions),
          null,
          null,
          now,
          now,
        );
        count++;
      }
      return { inserted: count };
    });
  }
}
