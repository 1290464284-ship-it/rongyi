import { Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { Chair } from "@dental/shared";

@Injectable()
export class ChairsService extends BaseService<Chair> {
  constructor(dbService: DbService) {
    super(dbService, "Chair", [], ["name"]);
  }

  async findAll(params?: { page?: number; pageSize?: number }) {
    const { page = 1, pageSize = 100 } = params || {};
    const query = "SELECT * FROM Chair WHERE active = 1 ORDER BY name LIMIT ? OFFSET ?";
    const items = this.dbService.prepare(query).all(pageSize, (page - 1) * pageSize) as Chair[];
    const total = (this.dbService.prepare("SELECT COUNT(*) as count FROM Chair WHERE active = 1").get() as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async remove(id: string): Promise<void> {
    this.dbService.prepare("UPDATE Chair SET active = 0 WHERE id = ?").run(id);
  }
}
