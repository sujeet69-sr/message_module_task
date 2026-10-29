import { Router } from 'express';
import { messageController } from '../controllers/messageController.js';
import { requireTenantHeader } from '../middleware/tenantAuth.js';

const router = Router();

// GET /api/v1/conversations/:conversationId/messages?limit=20&cursor=...
router.get(
  '/:conversationId/messages',
  requireTenantHeader,
  (req, res, next) => messageController.getConversationMessages(req, res, next)
);

export default router;
