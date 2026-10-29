import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_PATH: z.string().default('./data/messaging.db'),
  DB_CLIENT: z.enum(['sqlite', 'postgres']).optional(),
  DATABASE_URL: z.string().optional(),
  PGHOST: z.string().default('localhost'),
  PGPORT: z.coerce.number().default(5432),
  PGUSER: z.string().default('postgres'),
  PGPASSWORD: z.string().optional(),
  PGDATABASE: z.string().default('messaging_db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  WORKER_ENABLED: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default('true'),
  WORKER_CONCURRENCY: z.coerce.number().default(2),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().default(500),
  WORKER_MAX_RETRIES: z.coerce.number().default(3),
  WORKER_BACKOFF_BASE_MS: z.coerce.number().default(1000),
  API_SECRET_KEY: z.string().optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

let cachedConfig: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.format());
    throw new Error('Invalid environment configuration');
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export function isPostgres(): boolean {
  const config = getEnvConfig();
  if (config.DB_CLIENT === 'postgres') return true;
  if (config.DATABASE_URL && (config.DATABASE_URL.startsWith('postgres://') || config.DATABASE_URL.startsWith('postgresql://'))) {
    return true;
  }
  return false;
}

export function resetEnvConfig(): void {
  cachedConfig = null;
}
