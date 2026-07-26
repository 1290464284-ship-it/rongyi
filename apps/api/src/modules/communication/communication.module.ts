import { Module } from '@nestjs/common';
import { FollowUpsModule } from './follow-ups/follow-ups.module';
import { WechatModule } from './wechat/wechat.module';

@Module({
  imports: [FollowUpsModule, WechatModule],
})
export class CommunicationModule {}
