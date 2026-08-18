import pino from 'pino';
import type { Logger } from 'pino';
import { config } from './config.js';

/**
 * Structured JSON logging. Every log line carries the service name so that
 * Application Insights / Log Analytics queries can filter on it.
 */
export function createLogger(level: string = config.logLevel): Logger {
  return pino({
    level,
    base: {
      service: 'contoso-claims-api',
      env: config.nodeEnv,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

export const logger: Logger = createLogger();

export type { Logger };
