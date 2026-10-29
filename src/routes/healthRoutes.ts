import { Router } from 'express';
import { healthController } from '../controllers/healthController.js';

const router = Router();

router.get('/health', (req, res) => healthController.getHealth(req, res));
router.get('/metrics', (req, res) => healthController.getMetrics(req, res));

export default router;
