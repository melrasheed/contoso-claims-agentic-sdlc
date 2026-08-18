import type { AppConfig } from './config.js';
import { config as defaultConfig } from './config.js';
import type { Logger } from './logger.js';
import { logger as defaultLogger } from './logger.js';

/**
 * Azure Application Insights bootstrap.
 *
 * Telemetry is strictly opt-in: the SDK is only imported and started when
 * `APPLICATIONINSIGHTS_CONNECTION_STRING` is present, so local development and
 * unit tests never touch the network.
 */

interface TelemetryModule {
  useAzureMonitor?: (options: {
    azureMonitorExporterOptions: { connectionString: string };
  }) => void;
  setup?: (connectionString: string) => { start: () => void };
}

let started = false;

export async function initTelemetry(
  config: AppConfig = defaultConfig,
  logger: Logger = defaultLogger,
): Promise<boolean> {
  if (started) return true;

  const connectionString = config.appInsightsConnectionString;
  if (!connectionString) {
    logger.info(
      'Application Insights disabled (APPLICATIONINSIGHTS_CONNECTION_STRING not set)',
    );
    return false;
  }

  try {
    const telemetry = (await import('applicationinsights')) as unknown as TelemetryModule;

    if (typeof telemetry.useAzureMonitor === 'function') {
      telemetry.useAzureMonitor({
        azureMonitorExporterOptions: { connectionString },
      });
    } else if (typeof telemetry.setup === 'function') {
      telemetry.setup(connectionString).start();
    } else {
      logger.warn('Application Insights SDK exposed no known entry point; skipping');
      return false;
    }

    started = true;
    logger.info('Application Insights telemetry enabled');
    return true;
  } catch (error) {
    // Telemetry must never take the API down.
    logger.error({ err: error }, 'Failed to initialise Application Insights');
    return false;
  }
}

/** Test helper: forget that telemetry was started. */
export function resetTelemetryForTests(): void {
  started = false;
}
