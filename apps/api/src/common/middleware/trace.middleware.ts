import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'node:crypto';
import { AppLogger } from '../services/logger.service';

export const TRACE_ID_HEADER = 'X-Request-Id';
const SLOW_REQUEST_THRESHOLD_MS = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare global {
  namespace Express {
    interface Request {
      traceId: string;
    }
  }
}

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  private readonly logger = new AppLogger(TraceMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const raw = req.headers[TRACE_ID_HEADER.toLowerCase()] as string | undefined;
    const traceId = raw && UUID_RE.test(raw) ? raw : crypto.randomUUID();
    req.traceId = traceId;
    res.setHeader(TRACE_ID_HEADER, traceId);

    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (duration > SLOW_REQUEST_THRESHOLD_MS) {
        this.logger.warn(
          `Slow request: ${req.method} ${req.originalUrl} status=${res.statusCode} duration=${duration.toFixed(2)}ms threshold=${SLOW_REQUEST_THRESHOLD_MS}ms (trace:${traceId.slice(0, 8)})`,
          TraceMiddleware.name,
        );
      }
    });

    next();
  }
}
