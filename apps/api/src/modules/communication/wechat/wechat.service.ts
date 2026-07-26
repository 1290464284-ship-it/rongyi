import { Injectable } from "@nestjs/common";
import { BusinessValidationException } from "@common/errors";
import { WechatMessage } from "@dental/shared";
import { BaseService } from "../../../common/services/base.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { DbService } from "../../../db/db.service";
import { PAGINATION } from "../../../common/constants/pagination";
import * as crypto from "node:crypto";

/**
 * 迁移说明：sendMessage 方法从直接使用 db.prepare INSERT 迁移到使用 super.create
 * 利用 BaseService 的通用创建逻辑，自动处理：UUID 生成、clinicId 注入、时间戳设置
 * clinicId 为 null 时使用 BaseRepository.insert 替代直接 db.prepare
 */
@Injectable()
export class WechatService extends BaseService<WechatMessage> {

  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, 'WechatMessage', [], ['patientId']);
  }

  async sendMessage(dto: { patientId: string; type: string; content?: string; templateId?: string }) {
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    // 迁移：当 clinicId 存在时使用 super.create，否则使用 BaseRepository.insert
    if (clinicId) {
      const result = await super.create({
        patientId: dto.patientId,
        type: dto.type,
        content: dto.content || null,
        status: "PENDING",
        templateId: dto.templateId || null,
      });
      return { id: result.id, status: "PENDING" };
    } else {
      this.baseRepository.insert(this.dbService, 'WechatMessage', {
        id,
        patientId: dto.patientId,
        type: dto.type,
        content: dto.content || null,
        status: "PENDING",
        templateId: dto.templateId || null,
        clinicId: null,
        createdAt: now,
      });
      return { id, status: "PENDING" };
    }
  }

  async findByPatient(patientId: string) {
    return this.findMany({ patientId }, 1, 100);
  }

  async findMany(params: unknown, page = 1, pageSize: number = PAGINATION.DEFAULT_PAGE_SIZE) {
    const p = (params ?? {}) as { patientId?: string; type?: string; status?: string };
    const filters: Record<string, unknown> = {};
    if (p?.patientId) filters.patientId = p.patientId;
    if (p?.type) filters.type = p.type;
    if (p?.status) filters.status = p.status;
    return super.findMany({ filters, page, pageSize });
  }

  // === Stub methods — throw until implemented ===
  async getAppointmentReminders() { throw new BusinessValidationException('此功能尚未实现'); }
  async send(_dto: unknown) { throw new BusinessValidationException('此功能尚未实现'); }
  async sendBatch(_dto: unknown) { throw new BusinessValidationException('此功能尚未实现'); }
  async getBirthdayPatients() { throw new BusinessValidationException('此功能尚未实现'); }
}
