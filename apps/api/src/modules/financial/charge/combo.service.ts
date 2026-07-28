import { Injectable } from '@nestjs/common';
import { BusinessNotFoundException } from '@common/errors';
import { DbService } from '../../../db/db.service';
import { BaseService } from '../../../common/services/base.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { ChargeCombo } from './entities/combo.entity';
import { CreateComboDto, UpdateComboDto } from './dto/combo.dto';
import * as crypto from 'node:crypto';

@Injectable()
export class ComboService extends BaseService<ChargeCombo> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
  ) {
    super(dbService, clinicContext, 'ChargeCombo', [], ['name'], [
      { table: 'ChargeComboItem', foreignKey: 'comboId' },
    ]);
  }

  async listCombos(userId?: string, page = 1, pageSize = 100) {
    if (userId) {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const filteredItems = this.dbService.prepare(
        `SELECT id, name, category, isPublic, creatorId, clinicId, createdAt, updatedAt, deletedAt FROM ChargeCombo WHERE deletedAt IS NULL${clinicClause} AND (isPublic = 1 OR creatorId = ?) ORDER BY createdAt DESC LIMIT ? OFFSET ?`
      ).all(...clinicParams, userId, pageSize, (page - 1) * pageSize) as ChargeCombo[];
      return filteredItems;
    }

    const items = await this.findMany({
      page,
      pageSize,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });

    return items.items;
  }

  async createCombo(dto: CreateComboDto, creatorId?: string) {
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    const comboId = crypto.randomUUID();

    const combo = await this.dbService.transaction((db) => {
      // Create header
      db.prepare(
        `INSERT INTO ChargeCombo (id, name, category, isPublic, creatorId, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        comboId,
        dto.name,
        dto.category || null,
        dto.isPublic ? 1 : 0,
        creatorId || null,
        clinicId || null,
        now,
        now,
      );

      // Create items if provided
      if (dto.items && dto.items.length > 0) {
        const insertItem = db.prepare(
          `INSERT INTO ChargeComboItem (id, comboId, treatmentCatalogId, itemName, price, quantity, clinicId) VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const item of dto.items) {
          insertItem.run(
            crypto.randomUUID(),
            comboId,
            item.treatmentCatalogId || null,
            item.itemName,
            item.price,
            item.quantity,
            clinicId,
          );
        }
      }

      return db.prepare(`SELECT id, name, category, isPublic, creatorId, clinicId, createdAt, updatedAt, deletedAt FROM ChargeCombo WHERE id = ?`).get(comboId) as ChargeCombo;
    });

    this.logAudit(this.dbService, 'COMBO_CREATE', combo.id, 'ChargeCombo', {
      afterData: { name: combo.name, category: combo.category, isPublic: combo.isPublic },
    });

    return this.findOne(combo.id);
  }

  async updateCombo(id: string, dto: UpdateComboDto) {
    const updates: Partial<ChargeCombo> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.category !== undefined) updates.category = dto.category;
    if (dto.isPublic !== undefined) updates.isPublic = dto.isPublic ? 1 : 0;

    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();

    const updatedCombo = await this.dbService.transaction((db) => {
      // Update header
      const updateFields: string[] = ['updatedAt = ?'];
      const updateParams: unknown[] = [now];
      if (updates.name !== undefined) { updateFields.push('name = ?'); updateParams.push(updates.name); }
      if (updates.category !== undefined) { updateFields.push('category = ?'); updateParams.push(updates.category); }
      if (updates.isPublic !== undefined) { updateFields.push('isPublic = ?'); updateParams.push(updates.isPublic); }
      updateParams.push(id);
      const updateResult = db.prepare(`UPDATE ChargeCombo SET ${updateFields.join(', ')} WHERE id = ? AND deletedAt IS NULL`).run(...updateParams);
      if (updateResult.changes === 0) {
        throw new BusinessNotFoundException("套餐不存在");
      }

      // Update items if provided
      // 使用软删除替换物理删除，避免"恢复套餐"时出现空套餐（子项永久丢失）
      if (dto.items !== undefined) {
        db.prepare(
          `UPDATE ChargeComboItem SET deletedAt = ?, updatedAt = ? WHERE comboId = ? AND clinicId = ? AND deletedAt IS NULL`,
        ).run(now, now, id, clinicId);

        if (dto.items.length > 0) {
          const insertItem = db.prepare(
            `INSERT INTO ChargeComboItem (id, comboId, treatmentCatalogId, itemName, price, quantity, clinicId) VALUES (?, ?, ?, ?, ?, ?, ?)`
          );
          for (const item of dto.items) {
            insertItem.run(
              crypto.randomUUID(),
              id,
              item.treatmentCatalogId || null,
              item.itemName,
              item.price,
              item.quantity,
              clinicId,
            );
          }
        }
      }

      const result = db.prepare(`SELECT id, name, category, isPublic, creatorId, clinicId, createdAt, updatedAt, deletedAt FROM ChargeCombo WHERE id = ? AND deletedAt IS NULL`).get(id) as ChargeCombo | undefined;
      if (!result) {
        throw new BusinessNotFoundException("套餐不存在");
      }
      return result;
    });

    this.logAudit(this.dbService, 'COMBO_UPDATE', id, 'ChargeCombo', {
      afterData: { name: updatedCombo.name, category: updatedCombo.category, isPublic: updatedCombo.isPublic },
    });

    return updatedCombo;
  }

  async deleteCombo(id: string) {
    try {
      await this.softDelete(id);
      this.logAudit(this.dbService, 'COMBO_DELETE', id, 'ChargeCombo');
    } catch (error) {
      if (!(error instanceof BusinessNotFoundException)) {
        throw error;
      }
    }

    return id;
  }
}