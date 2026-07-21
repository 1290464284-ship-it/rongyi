import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { DbService } from '../../../db/db.service';

@Module({
  providers: [SearchService, DbService],
  controllers: [SearchController],
})
export class SearchModule {}
