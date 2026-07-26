import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DatabaseConsistencyService } from './db-consistency.service';
import { ChargeConsistencyChecker } from './charge-consistency-checker';
import { MemberCardConsistencyChecker } from './member-card-consistency-checker';
import { InventoryConsistencyChecker } from './inventory-consistency-checker';
import { ForeignKeyConsistencyChecker } from './foreign-key-consistency-checker';
import { BusinessRuleConsistencyChecker } from './business-rule-consistency-checker';
import { DbModule } from '../../../db/db.module';

@Module({
  imports: [DbModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    DatabaseConsistencyService,
    ChargeConsistencyChecker,
    MemberCardConsistencyChecker,
    InventoryConsistencyChecker,
    ForeignKeyConsistencyChecker,
    BusinessRuleConsistencyChecker,
  ],
  exports: [DatabaseConsistencyService, HealthService],
})
export class HealthModule {}
