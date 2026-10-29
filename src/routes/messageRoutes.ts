import { Router } from 'express';
import { messageController } from '../controllers/messageController.js';
import { extractTenantId } from '../middleware/tenantAuth.js';

const router = Router();

router.post('/', extractTenantId, (req, res, next) => messageController.createMessage(req, res, next));
router.get('/:messageId', extractTenantId, (req, res, next) => messageController.getMessage(req, res, next));

export default router;
