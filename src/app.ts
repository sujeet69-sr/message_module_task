import express, { Request, Response } from 'express';
import { correlationIdMiddleware } from './middleware/correlationId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLoggingMiddleware } from './middleware/logging.js';
import routes from './routes/index.js';

export function createApp(): express.Application {
  const app = express();

  // Basic security and parsing middleware
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(correlationIdMiddleware);
  app.use(requestLoggingMiddleware);

  // Mount API and health routes
  app.use(routes);

  // 404 handler for undefined routes
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`,
    });
  });

  // Centralized application error handling middleware
  app.use(errorHandler);

  return app;
}

export const app = createApp();
