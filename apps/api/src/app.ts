import express from 'express';
import cors from 'cors';
import { config as defaultConfig, type AppConfig } from './config.js';
import { logger as defaultLogger, type Logger } from './logger.js';
import { ClaimsRepository, claimsRepository as defaultRepository } from './repository.js';
import { FaultController, faultController as defaultFaultController } from './faults.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createClaimsRouter } from './routes/claims.js';
import { createStatsRouter } from './routes/stats.js';
import { createAdminRouter } from './routes/admin.js';

export interface CreateAppOptions {
  config?: AppConfig;
  logger?: Logger;
  repository?: ClaimsRepository;
  faultController?: FaultController;
}

export interface AppContext {
  app: express.Express;
  config: AppConfig;
  logger: Logger;
  repository: ClaimsRepository;
  faultController: FaultController;
}

/** Builds a fully wired Express application. Every dependency is injectable. */
export function createAppContext(options: CreateAppOptions = {}): AppContext {
  const config = options.config ?? defaultConfig;
  const logger = options.logger ?? defaultLogger;
  const repository = options.repository ?? defaultRepository;
  const faults = options.faultController ?? defaultFaultController;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(requestId());
  app.use(requestLogger(logger));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'contoso-claims-api',
      env: config.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/claims', createClaimsRouter({ repository, faultController: faults }));
  app.use('/api/stats', createStatsRouter(repository));
  app.use('/api/admin', createAdminRouter({ faultController: faults, config, logger }));

  app.use(notFoundHandler());
  app.use(errorHandler(logger, !config.isProduction));

  return { app, config, logger, repository, faultController: faults };
}

/** Convenience wrapper when only the Express instance is needed. */
export function createApp(options: CreateAppOptions = {}): express.Express {
  return createAppContext(options).app;
}
