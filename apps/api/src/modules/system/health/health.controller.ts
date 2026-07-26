import { BusinessNotFoundException } from '@common/errors';
import { Controller, Get, Param } from '@nestjs/common';

import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { DatabaseConsistencyService, ConsistencyCheckResult, CheckResult } from './db-consistency.service';
import { HealthService, AppInfoResponse, HealthCheckDetailResult } from './health.service';

@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  constructor(
    private dbConsistencyService: DatabaseConsistencyService,
    private healthService: HealthService,
  ) {}

  @ApiOperation({ summary: '验证健康检查' })
  @Get()
  @Public()
  @ApiOperation({ summary: '健康检查' })
  check(): { status: 'ok' | 'down' } {
    return this.healthService.checkSimple();
  }

  @ApiOperation({ summary: '应用信息' })
  @Get('info')
  @Roles(Role.BOSS)
  info(): AppInfoResponse {
    return this.healthService.getInfo();
  }

  @ApiOperation({ summary: '获取详情' })
  @Get('detail')
  @Roles(Role.BOSS)
  async detail(): Promise<HealthCheckDetailResult> {
    return this.healthService.getDetail();
  }

  @ApiOperation({ summary: 'dbConsistency - 健康检查' })
  @Get('db-consistency')
  @Roles(Role.BOSS)
  async dbConsistency(): Promise<ConsistencyCheckResult> {
    return this.dbConsistencyService.runAllChecks();
  }

  @ApiOperation({ summary: 'dbConsistencyCheck - 健康检查' })
  @Get('db-consistency/:checkName')
  @Roles(Role.BOSS)
  async dbConsistencyCheck(@Param('checkName') checkName: string): Promise<CheckResult> {
    const availableChecks = this.dbConsistencyService.getAvailableChecks();
    if (!availableChecks.includes(checkName)) {
      throw new BusinessNotFoundException(`未找到检查项: ${checkName}`);
    }
    return this.dbConsistencyService.runCheck(checkName);
  }

  @ApiOperation({ summary: '获取健康检查' })
  @Get('db-consistency-checks/list')
  @Roles(Role.BOSS)
  getAvailableChecks(): string[] {
    return this.dbConsistencyService.getAvailableChecks();
  }
}
