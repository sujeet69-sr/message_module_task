import { runMigrations } from '../migrations/migrate.js';
import { app } from './app.js';
import { getEnvConfig } from './config/env.js';
import { closeDatabase, getDatabase } from './db/database.js';
import { workerQueueService } from './services/workerQueue.js';
import { logger } from './utils/logger.js';

async function bootstrap(): Promise<void> {
  const config = getEnvConfig();

  logger.info('Initializing Multi-Tenant Messaging Service', {
    env: config.NODE_ENV,
    port: config.PORT,
    database: config.DATABASE_PATH,
  });

  try {
    // 1. Ensure SQLite database connection and run schema migrations
    const db = getDatabase();
    runMigrations(db);
    logger.info('Database schema migrations applied successfully');

    // 2. Start asynchronous background worker queue
    workerQueueService.start();

    // 3. Start Express HTTP server
    const server = app.listen(config.PORT, () => {
      logger.info(`Server listening on http://localhost:${config.PORT}`);
    });

    // 4. Graceful shutdown handling
    const shutdown = (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);

      server.close(() => {
        logger.info('HTTP server closed');
        workerQueueService.stop();
        closeDatabase();
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
