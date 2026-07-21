import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

export const TRACE_ID_HEADER = 'X-Request-Id';

declare global {
  namespace Express {
    interface Request {
      traceId: string;
    }
  }
}

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const traceId = req.headers[TRACE_ID_HEADER.toLowerCase()] as string || crypto.randomUUID();
    req.traceId = traceId;
    res.setHeader(TRACE_ID_HEADER, traceId);
    next();
  }
}
