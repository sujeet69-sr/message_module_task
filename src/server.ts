import { runAllMigrations } from '../migrations/migrate.js';
import { app } from './app.js';
import { getEnvConfig, isPostgres } from './config/env.js';
import { getDatabaseAdapter } from './db/adapter.js';
import { workerQueueService } from './services/workerQueue.js';
import { logger } from './utils/logger.js';

async function bootstrap(): Promise<void> {
  const config = getEnvConfig();

  logger.info('Initializing Multi-Tenant Messaging Service', {
    env: config.NODE_ENV,
    port: config.PORT,
    databaseEngine: isPostgres() ? 'PostgreSQL' : 'SQLite',
    databaseTarget: isPostgres()
      ? (config.DATABASE_URL ? '[DATABASE_URL configured]' : `${config.PGHOST}:${config.PGPORT}/${config.PGDATABASE}`)
      : config.DATABASE_PATH,
  });

  try {
    // 1. Ensure database connection and run schema migrations
    await runAllMigrations();
    logger.info('Database schema migrations applied successfully');

    // 2. Start asynchronous background worker queue
    workerQueueService.start();

    // 3. Start Express HTTP server
    const server = app.listen(config.PORT, () => {
      logger.info(`Server listening on http://localhost:${config.PORT}`);
    });

    // 4. Graceful shutdown handling
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);

      server.close(async () => {
        logger.info('HTTP server closed');
        workerQueueService.stop();
        await getDatabaseAdapter().close();
        logger.info('Graceful shutdown completed');
        process.exit(0);
      });

      // Force shutdown after timeout
      setTimeout(() => {
        logger.error('Graceful shutdown timed out, force terminating');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error: any) {
    logger.error('Failed to bootstrap application', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

bootstrap();
