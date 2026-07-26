import { SetMetadata } from '@nestjs/common';

export const OPERATION_LOG_RESOURCE_KEY = 'operation_log_resource';

/**
 * 标记 Controller 在操作日志中使用的资源名。
 * 优先于 @ApiTags 作为资源名来源，用于保持操作日志 action 文本稳定。
 */
export const OperationLogResource = (resource: string) =>
  SetMetadata(OPERATION_LOG_RESOURCE_KEY, resource);
