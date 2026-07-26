import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const DEFAULT_TIMEOUT_MS = 30000;
const LONG_RUNNING_TIMEOUT_MS = 120000;

const LONG_RUNNING_PATHS = [
  '/api/backup',
  '/api/restore',
  '/api/reports',
  '/api/export',
];

@Injectable()
export class RequestTimeoutMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const path = req.path;
    const isLongRunning = LONG_RUNNING_PATHS.some((p) => path.startsWith(p) || path.includes(p));
    const timeoutMs = isLongRunning ? LONG_RUNNING_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

    let timeoutId: NodeJS.Timeout | null = null;
    let responded = false;

    const cleanup = () => {
      if (responded) return;
      responded = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const handleTimeout = () => {
      if (responded) return;
      cleanup();
      if (!res.headersSent) {
        res.status(408).json({
          statusCode: 408,
          message: '请求超时，请稍后重试',
          error: 'Request Timeout',
        });
      }
      req.destroy();
    };

    timeoutId = setTimeout(handleTimeout, timeoutMs);

    const originalEnd = res.end.bind(res);
    res.end = function (...args: Parameters<typeof res.end>) {
      cleanup();
      return originalEnd(...args);
    } as typeof res.end;

    res.on('finish', cleanup);
    res.on('close', cleanup);

    next();
  }
}
