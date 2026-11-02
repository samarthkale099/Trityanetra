import { Router } from 'express';
import { judge0Callback } from './judge0.callback.controller';

const router = Router();

// No JWT here on purpose: the caller is Judge0, authenticated by the secret in the URL.
router.put('/callback/:token', judge0Callback);
router.post('/callback/:token', judge0Callback);

export default router;
