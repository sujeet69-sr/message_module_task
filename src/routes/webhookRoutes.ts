import { Router } from 'express';
import { webhookController } from '../controllers/webhookController.js';

const router = Router();

// POST /api/v1/webhooks/provider
router.post('/provider', (req, res, next) => webhookController.handleProviderWebhook(req, res, next));

export default router;
