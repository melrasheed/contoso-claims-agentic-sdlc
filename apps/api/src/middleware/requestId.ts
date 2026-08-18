import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Returns the correlation id assigned to a request. */
export function getRequestId(req: Request): string {
  const fromLogger = (req as { id?: unknown }).id;
  if (typeof fromLogger === 'string' && fromLogger.length > 0) return fromLogger;

  const header = req.headers[REQUEST_ID_HEADER];
  if (typeof header === 'string' && header.length > 0) return header;

  return 'unknown';
}

/**
 * Generates (or honours an inbound) correlation id and echoes it back on the
 * response so that browser, API logs and Application Insights traces line up.
 */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const id = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();

    (req as { id?: string }).id = id;
    req.headers[REQUEST_ID_HEADER] = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}
