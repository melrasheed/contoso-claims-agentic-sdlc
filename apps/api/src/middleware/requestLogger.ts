import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../logger.js';
import { getRequestId } from './requestId.js';

/**
 * Minimal structured access log: one JSON line per completed request, carrying
 * the correlation id so logs stitch together with Application Insights traces.
 */
export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const payload = {
        requestId: getRequestId(req),
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      };

      if (res.statusCode >= 500) {
        logger.error(payload, 'request failed');
      } else if (res.statusCode >= 400) {
        logger.warn(payload, 'request completed with client error');
      } else {
        logger.info(payload, 'request completed');
      }
    });

    next();
  };
}
