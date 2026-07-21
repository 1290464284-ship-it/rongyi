/**
 * Bootstrap Logger 适配器
 *
 * P2 修复（log.ts 与 logger.service.ts 几乎逐字重复）：
 * 原文件复制了 logger.service.ts 的 sanitizeObject/sanitizeString/缓冲写入逻辑，
 * 仅 API 签名不同（旧 API：error(msg, ctx, err) vs AppLogger.error(msg, err, ctx)）。
 *
 * 现统一委托给 AppLogger 单例，保留旧 API 以便 database.ts / paths.ts 等
 * 在 NestJS DI 容器引导前加载的模块无需改动调用代码。
 *
 * 新代码请直接 `new AppLogger(context)` 或通过 DI 注入，不要再使用本文件。
 */
import { AppLogger } from '../services/logger.service';

const bootstrapLogger = new AppLogger('Bootstrap');

export const logger = {
  debug: (message: any, context: string = 'Bootstrap') => bootstrapLogger.debug(message, context),
  info: (message: any, context: string = 'Bootstrap') => bootstrapLogger.log(message, context),
  warn: (message: any, context: string = 'Bootstrap') => bootstrapLogger.warn(message, context),
  // 旧 API：error(message, context, error?) → AppLogger.error(message, error?, context?)
  error: (message: any, context: string = 'Bootstrap', error?: Error) => {
    bootstrapLogger.error(message, error, context);
  },
};
