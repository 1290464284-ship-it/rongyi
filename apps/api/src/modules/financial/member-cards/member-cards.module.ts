import { Module } from '@nestjs/common';
import { MemberCardsController } from './member-cards.controller';
import { MemberCardsService } from './member-cards.service';
import { DbModule } from '../../../db/db.module';

@Module({
  imports: [DbModule],
  controllers: [MemberCardsController],
  providers: [MemberCardsService],
})
export class MemberCardsModule {}
