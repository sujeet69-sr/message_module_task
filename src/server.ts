import { runMigrations } from '../migrations/migrate.js';
import { app } from './app.js';
import { getEnvConfig } from './config/env.js';
import { closeDatabase } from './db/database.js';
import { workerQueueService } from './services/workerQueue.js';
import { logger } from './utils/logger.js';

async function bootstrap(): Promise<void> {
  const config = getEnvConfig();

  logger.info('Initializing Multi-Tenant Messaging Service (PostgreSQL)', {
    env: config.NODE_ENV,
    port: config.PORT,
    host: config.PGHOST,
    database: config.PGDATABASE,
  });

  try {
    // 1. Ensure PostgreSQL database connection and run schema migrations
    await runMigrations();
    logger.info('PostgreSQL schema migrations applied successfully');

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
        await closeDatabase();
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
