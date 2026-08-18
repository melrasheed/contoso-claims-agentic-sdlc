/**
 * Runtime configuration, resolved once at process start from the environment.
 */

export interface AppConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  isTest: boolean;
  logLevel: string;
  /**
   * Enables the deliberate fault-injection endpoints under `/api/admin`.
   * Defaults to on outside of production so the incident-detection demo works
   * out of the box; must be opted into explicitly in production.
   */
  adminEnabled: boolean;
  corsOrigins: string[];
  appInsightsConnectionString: string | undefined;
  /** Default lifetime of an injected fault before it auto-expires. */
  defaultFaultDurationSeconds: number;
  /** Size of each buffer allocated by the `memory` fault mode. */
  faultMemoryChunkBytes: number;
  /** Upper bound on memory retained by the `memory` fault mode. */
  faultMemoryMaxBytes: number;
  /** Claims above this requested amount require a second approval. */
  dualApprovalThreshold: number;
}

const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  const corsOrigins = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();

  return {
    port: parseInteger(env.PORT, 3001),
    nodeEnv,
    isProduction,
    isTest,
    logLevel: env.LOG_LEVEL?.trim() || (isTest ? 'silent' : 'info'),
    adminEnabled: parseBoolean(env.ADMIN_ENABLED, !isProduction),
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : DEFAULT_CORS_ORIGINS,
    appInsightsConnectionString:
      connectionString && connectionString.length > 0 ? connectionString : undefined,
    defaultFaultDurationSeconds: parseInteger(env.FAULT_DEFAULT_DURATION_SECONDS, 300),
    faultMemoryChunkBytes: parseInteger(env.FAULT_MEMORY_CHUNK_MB, 8) * 1024 * 1024,
    faultMemoryMaxBytes: parseInteger(env.FAULT_MEMORY_MAX_MB, 256) * 1024 * 1024,
    dualApprovalThreshold: parseInteger(env.DUAL_APPROVAL_THRESHOLD, 50_000),
  };
}

export const config: AppConfig = loadConfig();
