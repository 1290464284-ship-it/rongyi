import { Module } from '@nestjs/common';
import { FollowUpRecommenderController } from './follow-up-recommender.controller';
import { FollowUpRecommenderService } from './follow-up-recommender.service';

@Module({
  controllers: [FollowUpRecommenderController],
  providers: [FollowUpRecommenderService],
  exports: [FollowUpRecommenderService],
})
export class FollowUpRecommenderModule {}
