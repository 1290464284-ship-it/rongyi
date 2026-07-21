import { Module } from '@nestjs/common';
import { ChargeV2Controller } from './charge-v2.controller';
import { ChargeV2Service } from './charge-v2.service';

@Module({
  controllers: [ChargeV2Controller],
  providers: [ChargeV2Service],
  exports: [ChargeV2Service],
})
export class ChargeV2Module {}
