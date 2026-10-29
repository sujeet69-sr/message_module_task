import { NextFunction, Request, Response } from 'express';
import { webhookService } from '../services/webhookService.js';
import { WebhookEventSchema } from '../utils/validator.js';

export class WebhookController {
  public async handleProviderWebhook(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const parsedBody = WebhookEventSchema.parse(req.body);
      const result = await webhookService.processWebhookEvent(parsedBody);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const webhookController = new WebhookController();
