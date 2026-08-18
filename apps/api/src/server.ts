import { createAppContext } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { initTelemetry } from './telemetry.js';

async function main(): Promise<void> {
  await initTelemetry(config, logger);

  const { app } = createAppContext({ config, logger });

  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        env: config.nodeEnv,
        adminEnabled: config.adminEnabled,
        corsOrigins: config.corsOrigins,
      },
      'Contoso Claims API listening',
    );
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    server.close((error) => {
      if (error) {
        logger.error({ err: error }, 'Error during shutdown');
        process.exitCode = 1;
      }
      process.exit(process.exitCode ?? 0);
    });

    // Never hang forever waiting on in-flight (possibly fault-injected) requests.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Fatal startup error');
  process.exit(1);
});
