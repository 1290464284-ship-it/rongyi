import { Injectable } from '@nestjs/common';
import { BusinessValidationException } from '@common/errors';
import { WechatMessage } from "@dental/shared";
import { BaseService } from "../../../common/services/base.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { DbService } from "../../../db/db.service";
import { PAGINATION } from "../../../common/constants/pagination";

/**
 * P1 修复：消除 null clinicId 绕过多租户隔离的漏洞
 * 原先 clinicId 为 null 时直接调用 BaseRepository.insert 写入 clinicId=null 的记录，
 * 这类记录在 buildClinicFilterOptional 路径下会被全诊所可见，构成跨租户数据泄露。
 * 现在统一走 super.create()，由 BaseService.create 强制校验 clinicId（缺失时抛 ForbiddenException）。
 */
@Injectable()
export class WechatService extends BaseService<WechatMessage> {

  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, { tableName: 'WechatMessage', searchFields: ['patientId'] });
  }

  async sendMessage(dto: { patientId?: string; type?: string; content?: string; templateId?: string }) {
    if (!dto.patientId) {
      throw new BusinessValidationException('patientId 不能为空');
    }
    if (!dto.type) {
      throw new BusinessValidationException('type 不能为空');
    }
    // 统一走 super.create：BaseService.create 会在 clinicId 缺失且未显式 skipClinicFilter 时抛 ForbiddenException
    const result = await super.create({
      patientId: dto.patientId,
      type: dto.type,
      content: dto.content || undefined,
      status: "PENDING",
      templateId: dto.templateId || undefined,
    });
    this.logAudit(this.dbService, "WECHAT_SEND", result.id, "WechatMessage", { afterData: { patientId: dto.patientId, type: dto.type } });
    return result;
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
  async send(dto: { patientId?: string; type?: string; content?: string; templateId?: string }) {
    return this.sendMessage(dto);
  }

  async sendBatch(dto: { patientIds?: string[]; type?: string; content?: string; templateId?: string }) {
    if (!dto.patientIds || dto.patientIds.length === 0) {
      throw new BusinessValidationException('patientIds 不能为空');
    }
    const results: WechatMessage[] = [];
    for (const patientId of dto.patientIds) {
      const result = await this.sendMessage({ patientId, type: dto.type, content: dto.content, templateId: dto.templateId });
      results.push(result);
    }
    return { count: results.length, results };
  }
  async getBirthdayPatients() { throw new BusinessValidationException('此功能尚未实现'); }
}
