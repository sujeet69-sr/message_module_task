import { Router } from 'express';
import conversationRoutes from './conversationRoutes.js';
import healthRoutes from './healthRoutes.js';
import messageRoutes from './messageRoutes.js';
import webhookRoutes from './webhookRoutes.js';

const router = Router();

router.use('/api/v1/messages', messageRoutes);
router.use('/api/v1/conversations', conversationRoutes);
router.use('/api/v1/webhooks', webhookRoutes);
router.use('/', healthRoutes);

export default router;
