import { Module } from '@nestjs/common';
import { MemberCardsController } from './member-cards.controller';
import { MemberCardsService } from './member-cards.service';
import { DbModule } from '../../../db/db.module';
import { MemberCardLogRepository } from './repositories/member-card-log.repository';
import { MemberPointLogRepository } from './repositories/member-point-log.repository';
import { StatsModule } from '../../system/stats/stats.module';

@Module({
  imports: [DbModule, StatsModule],
  controllers: [MemberCardsController],
  providers: [MemberCardsService, MemberCardLogRepository, MemberPointLogRepository],
  exports: [MemberCardsService, MemberCardLogRepository, MemberPointLogRepository],
})
export class MemberCardsModule {}
