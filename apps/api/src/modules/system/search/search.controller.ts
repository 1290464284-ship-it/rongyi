import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { SearchService } from './search.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';

@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('搜索')
@OperationLogResource('搜索')
@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  @ApiOperation({ summary: '搜索' })
  @Get()
  search(
    @Query('q') keyword: string,
  ) {
    if (!keyword || keyword.trim().length < 2) {
      return [];
    }
    return this.searchService.search(keyword.trim());
  }
}
