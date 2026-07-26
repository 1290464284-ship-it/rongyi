import { Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { Chair } from "@dental/shared";
import { PAGINATION } from "../../../common/constants/pagination";
import { AuditLogType } from "../../../common/constants";

@Injectable()
export class ChairsService extends BaseService<Chair> {
  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, "Chair", [], ["name"]);
  }

  async create(dto: Partial<Chair>): Promise<Chair> {
    const result = await super.create(dto);
    this.logAudit(this.dbService, AuditLogType.CHAIR_CREATE, result.id, "Chair", { afterData: { name: result.name } });
    return result;
  }

  async update(id: string, dto: Partial<Chair>): Promise<Chair> {
    const result = await super.update(id, dto);
    this.logAudit(this.dbService, AuditLogType.CHAIR_UPDATE, id, "Chair", { afterData: { name: result.name } });
    return result;
  }

  async findAll(params?: { page?: number; pageSize?: number }) {
    const { page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_LARGE } = params || {};
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const query = `SELECT id, name, location, active, clinicId, createdAt FROM Chair WHERE active = 1${clinicClause} ORDER BY name LIMIT ? OFFSET ?`;
    const items = this.dbService.prepare(query).all(...clinicParams, pageSize, (page - 1) * pageSize) as Chair[];
    const total = (this.dbService.prepare(`SELECT COUNT(*) as count FROM Chair WHERE active = 1${clinicClause}`).get(...clinicParams) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async remove(id: string): Promise<void> {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    this.dbService.prepare(`UPDATE Chair SET active = 0 WHERE id = ?${clinicClause}`).run(id, ...clinicParams);
    this.logAudit(this.dbService, AuditLogType.CHAIR_DELETE, id, "Chair");
  }
}
