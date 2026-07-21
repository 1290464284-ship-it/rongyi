import { Module } from '@nestjs/common';
import { FollowUpsV2Controller } from './follow-ups-v2.controller';
import { FollowUpsV2Service } from './follow-ups-v2.service';
import { DbModule } from '../../../db/db.module';

@Module({
  imports: [DbModule],
  controllers: [FollowUpsV2Controller],
  providers: [FollowUpsV2Service],
})
export class FollowUpsV2Module {}
