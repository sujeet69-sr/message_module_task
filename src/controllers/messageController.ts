import { NextFunction, Request, Response } from 'express';
import { BadRequestError } from '../errors/AppError.js';
import { messageService } from '../services/messageService.js';
import {
  ConversationQuerySchema,
  CreateMessageSchema,
} from '../utils/validator.js';

export class MessageController {
  public async createMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = CreateMessageSchema.parse(req.body);
      const createdMessage = messageService.createMessage(parsedBody, req.tenantId);

      res.status(201).json({
        success: true,
        data: createdMessage,
      });
    } catch (error) {
      next(error);
    }
  }

  public async getMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const messageId = Array.isArray(req.params.messageId)
        ? req.params.messageId[0]
        : req.params.messageId;

      if (!messageId || messageId.trim().length === 0) {
        throw new BadRequestError('messageId route parameter is required');
      }

      const message = messageService.getMessage(messageId.trim(), req.tenantId);

      res.status(200).json({
        success: true,
        data: message,
      });
    } catch (error) {
      next(error);
    }
  }

  public async getConversationMessages(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const conversationId = Array.isArray(req.params.conversationId)
        ? req.params.conversationId[0]
        : req.params.conversationId;

      if (!conversationId || conversationId.trim().length === 0) {
        throw new BadRequestError('conversationId route parameter is required');
      }

      const query = ConversationQuerySchema.parse(req.query);
      const tenantId = req.tenantId!; // Enforced by requireTenantHeader middleware

      const result = messageService.getConversationMessages(
        tenantId,
        conversationId.trim(),
        query
      );

      res.status(200).json({
        success: true,
        data: result.items,
        pagination: {
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          limit: result.limit,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const messageController = new MessageController();
