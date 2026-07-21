import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { DbService } from '../../../db/db.service';
import { AppLogger } from '../../../common/services/logger.service';

@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  private logger = new AppLogger(HealthController.name);
  constructor(private dbService: DbService) {}

  @Get()
  @Public()
  check() {
    try {
      const result = this.dbService.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: result?.ok === 1 ? 'connected' : 'error',
      };
    } catch (err) {
      this.logger.error('健康检查失败：数据库连接异常', err);
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
      };
    }
  }
}
