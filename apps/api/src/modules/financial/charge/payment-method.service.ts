import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { BaseService } from '../../../common/services/base.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { PaymentMethod } from './entities/payment-method.entity';
import { AuditLogType } from '../../../common/constants';

@Injectable()
export class PaymentMethodService extends BaseService<PaymentMethod> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
  ) {
    super(dbService, clinicContext, {
      tableName: 'PaymentMethod',
      searchFields: ['name', 'code'],
    });
  }

  listPaymentMethods() {
    return this.findMany({ sortBy: 'sortOrder', sortOrder: 'ASC' });
  }

  createPaymentMethod(dto: { name: string; code: string; parentId?: string; sortOrder?: number }) {
    return this.create(dto);
  }

  async create(dto: Partial<PaymentMethod>): Promise<PaymentMethod> {
    const result = await super.create(dto);
    this.logAudit(this.dbService, AuditLogType.PAYMENT_METHOD_CREATE, result.id, "PaymentMethod", { afterData: { name: result.name, code: result.code } });
    return result;
  }

  updatePaymentMethod(id: string, dto: Partial<{ name: string; code: string; parentId: string; sortOrder: number }>) {
    return this.update(id, dto);
  }

  async update(id: string, dto: Partial<PaymentMethod>): Promise<PaymentMethod> {
    const result = await super.update(id, dto);
    this.logAudit(this.dbService, AuditLogType.PAYMENT_METHOD_UPDATE, id, "PaymentMethod", { afterData: { name: result.name, code: result.code } });
    return result;
  }

  deletePaymentMethod(id: string) {
    return this.softDelete(id);
  }

  async togglePaymentMethod(id: string) {
    const method = await this.findOne(id);
    const newIsEnabled = method.isEnabled ? 0 : 1;
    const result = await this.update(id, { isEnabled: newIsEnabled });
    this.logAudit(this.dbService, AuditLogType.PAYMENT_METHOD_TOGGLE, id, "PaymentMethod", { afterData: { isEnabled: newIsEnabled } });
    return result;
  }
}
