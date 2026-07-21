import { Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import * as crypto from "crypto";

const CLINIC_INFO_CACHE_KEY = "settings:clinicInfo";
const CLINIC_INFO_TTL = 10 * 60 * 1000;

@Injectable()
export class SettingsService {
  constructor(
    private dbService: DbService,
    private cache: CacheService,
  ) {}

  async getClinicInfo() {
    return this.cache.getOrSet(
      CLINIC_INFO_CACHE_KEY,
      () => {
        const rows = this.dbService.prepare("SELECT * FROM ClinicInfo").all() as Record<string, unknown>[];
        const result: Record<string, string> = {};
        for (const row of rows) {
          result[row.key as string] = (row.value as string) || "";
        }
        return result;
      },
      CLINIC_INFO_TTL,
    );
  }

  async updateClinicInfo(key: string, value: string) {
    const existing = this.dbService.prepare("SELECT id FROM ClinicInfo WHERE key = ?").get(key);
    const now = new Date().toISOString();
    if (existing) {
      this.dbService.prepare("UPDATE ClinicInfo SET value = ?, updatedAt = ? WHERE key = ?").run(value, now, key);
    } else {
      const id = crypto.randomUUID();
      this.dbService.prepare("INSERT INTO ClinicInfo (id, key, value, updatedAt) VALUES (?, ?, ?, ?)").run(id, key, value, now);
    }
    this.cache.del(CLINIC_INFO_CACHE_KEY);
    return { key, value };
  }

  async findAll() { return this.getClinicInfo(); }

  async upsertMany(data: Record<string, string>) {
    const now = new Date().toISOString();
    this.dbService.transaction((db) => {
      for (const [key, value] of Object.entries(data)) {
        const existing = db.prepare("SELECT id FROM ClinicInfo WHERE key = ?").get(key);
        if (existing) {
          db.prepare("UPDATE ClinicInfo SET value = ?, updatedAt = ? WHERE key = ?").run(value, now, key);
        } else {
          const id = crypto.randomUUID();
          db.prepare("INSERT INTO ClinicInfo (id, key, value, updatedAt) VALUES (?, ?, ?, ?)").run(id, key, value, now);
        }
      }
    });
    this.cache.del(CLINIC_INFO_CACHE_KEY);
    return { success: true };
  }
}
