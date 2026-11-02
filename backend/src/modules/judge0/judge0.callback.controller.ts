import { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env';
import { verifyCallbackToken } from './judge0.callbackToken';
import { judge0CallbackSchema } from './judge0.callback.schema';
import { recordJudge0Result } from './judge0.service';

// Judge0 does not sign its callbacks, so the secret lives in the callback URL we give it:
//   <public base url>/api/judge0/callback/<JUDGE0_CALLBACK_TOKEN>
// (Judge0 calls it with PUT; POST is accepted too.) The request logger redacts that path segment.
export const judge0Callback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!verifyCallbackToken(req.params.token, env.JUDGE0_CALLBACK_TOKEN)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsed = judge0CallbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid callback body' });
      return;
    }

    // Always answer 200 to an authenticated callback (even a replay or one we ignore),
    // so Judge0 does not keep retrying it.
    const result = await recordJudge0Result(parsed.data);
    res.status(200).json({ received: true, applied: result.applied });
  } catch (error) {
    next(error);
  }
};
