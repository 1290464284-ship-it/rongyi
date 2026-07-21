import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { BaseService } from '../../../common/services/base.service';
import { getCurrentClinicId } from '../../../common/services/clinic-context.service';

export interface Clinic {
  id: string;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  legalPerson?: string;
  businessLicense?: string;
  isActive: number;
  remark?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

@Injectable()
export class ClinicsService extends BaseService<Clinic> {
  constructor(dbService: DbService) {
    // Clinic 表本身不需要 clinicId 过滤（管理端需查看所有诊所）
    super(dbService, 'Clinic', [], ['name', 'code'], [], true, ['code']);
  }

  /**
   * 重写 findMany — 诊所管理不需要按 clinicId 过滤（跳过诊所隔离）
   */
  async findMany(options: Parameters<BaseService<Clinic>['findMany']>[0] = {}) {
    return super.findMany({ ...options, skipClinicFilter: true });
  }

  /**
   * 重写 findOne — 诊所管理不需要按 clinicId 过滤
   */
  async findOne(id: string): Promise<Clinic> {
    // 临时跳过 clinicId 过滤：直接用原始查询
    const item = this.dbService.prepare(
      `SELECT * FROM Clinic WHERE id = ? AND deletedAt IS NULL`,
    ).get(id) as Clinic | undefined;
    if (!item) {
      throw new BadRequestException('诊所不存在');
    }
    return item;
  }

  async create(dto: Partial<Clinic>): Promise<Clinic> {
    // 检查 code 唯一性
    const existing = this.dbService.prepare(
      'SELECT id FROM Clinic WHERE code = ? AND deletedAt IS NULL',
    ).get(dto.code) as { id: string } | undefined;
    if (existing) {
      throw new ConflictException(`诊所编码 "${dto.code}" 已存在`);
    }

    // Clinic 表本身的 clinicId 列无意义（它是 clinicId 的来源），但 BaseService.create
    // 会自动注入当前用户的 clinicId。这在功能上无害（Clinic 查询已跳过 clinicId 过滤）。
    return super.create(dto);
  }

  /**
   * 获取当前用户的诊所信息
   */
  async getCurrentClinic(): Promise<Clinic | null> {
    const clinicId = getCurrentClinicId();
    if (!clinicId) return null;
    return this.dbService.prepare(
      'SELECT * FROM Clinic WHERE id = ? AND isActive = 1 AND deletedAt IS NULL',
    ).get(clinicId) as Clinic | null;
  }

  /**
   * 获取所有活跃诊所（供用户注册/切换时选择）
   */
  async findActive(): Promise<Clinic[]> {
    return this.dbService.prepare(
      'SELECT id, name, code, address, phone FROM Clinic WHERE isActive = 1 AND deletedAt IS NULL ORDER BY name',
    ).all() as Clinic[];
  }
}
