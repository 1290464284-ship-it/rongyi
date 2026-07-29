import { Module } from '@nestjs/common';
import { MemberCardsController } from './member-cards.controller';
import { MemberCardsService } from './member-cards.service';
import { MemberCardCoreService } from './member-card-core.service';
import { MemberCardBalanceService } from './member-card-balance.service';
import { MemberCardPointsService } from './member-card-points.service';
import { DbModule } from '../../../db/db.module';
import { MemberCardLogRepository } from './repositories/member-card-log.repository';
import { MemberPointLogRepository } from './repositories/member-point-log.repository';
import { StatsModule } from '../../system/stats/stats.module';

@Module({
  imports: [DbModule, StatsModule],
  controllers: [MemberCardsController],
  providers: [
    MemberCardsService,
    MemberCardCoreService,
    MemberCardBalanceService,
    MemberCardPointsService,
    MemberCardLogRepository,
    MemberPointLogRepository,
  ],
  exports: [MemberCardsService, MemberCardBalanceService, MemberCardLogRepository, MemberPointLogRepository],
})
export class MemberCardsModule {}
