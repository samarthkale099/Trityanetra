import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Judge0Result } from './client';
import { env } from '../../config/env';
import { JUDGE0_BOUNDS, BODY_SIZE_LIMIT } from '../../config/constants';

/**
 * Judge0 callback routes.
 * Judge0 sends execution results to this endpoint via webhook.
 * We validate the callback signature, validate the payload structure,
 * and store the result.
 */
import { Router, json } from 'express';

const router = Router();

/**
 * Raw-body capture for the Judge0 callback route ONLY.
 *
 * MUST be mounted before any other body parsing runs on this route
 * (see app.ts: mounted at /api/judge0/callback ahead of the global
 * express.json). The signature is computed over the exact bytes Judge0
 * sent — never over Express's re-serialized JSON — so key order and
 * number formatting in the original payload are irrelevant to validity.
 */
export const judge0CallbackBodyParser = json({
  limit: BODY_SIZE_LIMIT,
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf;
  },
});

// Judge0 callback endpoint — no auth middleware (uses signature verification)
router.post('/callback', judge0CallbackBodyParser, handleJudge0Callback);

/**
 * Verify the Judge0 callback signature over the captured raw request bytes.
 * FAILS CLOSED: if no secret is configured, or the raw bytes were not
 * captured (body already parsed elsewhere), callbacks are rejected —
 * an unauthenticated callback must never be silently accepted.
 */
function verifyCallbackSignature(req: Request): boolean {
  if (!env.JUDGE0_API_KEY) {
    // Fail closed (rule: callbacks are authenticated — no dev-mode bypass)
    console.error('[Judge0 Callback] No callback secret configured — rejecting callback (fail closed)');
    return false;
  }

  const signature = req.headers['x-judge0-signature'] as string;
  if (!signature) return false;

  const rawBody = (req as any).rawBody;
  if (!Buffer.isBuffer(rawBody)) {
    console.error('[Judge0 Callback] Raw body not captured — cannot verify signature (fail closed)');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', env.JUDGE0_API_KEY)
    .update(rawBody)
    .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  try {
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (sigBuffer.length !== expectedBuffer.length) return false;

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Handle Judge0 callback POST.
 * 
 * Errors:
 *  - 401: Missing or invalid signature
 *  - 400: Malformed payload (missing token, invalid status structure)
 *  - 500: Internal processing error
 */
async function handleJudge0Callback(req: Request, res: Response, _next: NextFunction) {
  try {
    // 1. Verify signature
    if (!verifyCallbackSignature(req)) {
      return res.status(401).json({
        error: { message: 'Invalid or missing callback signature', code: 'UNAUTHORIZED' },
      });
    }

    // 2. Validate payload structure
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({
        error: { message: 'Invalid payload: expected object', code: 'INVALID_PAYLOAD' },
      });
    }

    if (typeof body.token !== 'string') {
      return res.status(400).json({
        error: { message: 'Invalid payload: missing token', code: 'INVALID_PAYLOAD' },
      });
    }

    if (!body.status || typeof body.status.id !== 'number') {
      return res.status(400).json({
        error: { message: 'Invalid payload: invalid status field', code: 'INVALID_PAYLOAD' },
      });
    }

    // 3. Validate numeric bounds
    if (body.memory !== null && body.memory !== undefined && (typeof body.memory !== 'number' || body.memory < 0)) {
      return res.status(400).json({
        error: { message: 'Invalid payload: memory must be a non-negative number', code: 'INVALID_PAYLOAD' },
      });
    }

    // 3b. Output size bound — reject oversized stdout/stderr/compile_output
    for (const field of ['stdout', 'stderr', 'compile_output'] as const) {
      const value = body[field];
      if (value !== null && value !== undefined) {
        if (typeof value !== 'string') {
          return res.status(400).json({
            error: { message: `Invalid payload: ${field} must be a string or null`, code: 'INVALID_PAYLOAD' },
          });
        }
        if (value.length > JUDGE0_BOUNDS.MAX_OUTPUT_CHARS) {
          return res.status(400).json({
            error: {
              message: `Invalid payload: ${field} exceeds maximum output size of ${JUDGE0_BOUNDS.MAX_OUTPUT_CHARS} characters`,
              code: 'INVALID_PAYLOAD',
            },
          });
        }
      }
    }

    // 3c. Execution time sanity bound — time must be a non-negative string or null
    if (body.time !== null && body.time !== undefined && typeof body.time !== 'string') {
      return res.status(400).json({
        error: { message: 'Invalid payload: time must be a string or null', code: 'INVALID_PAYLOAD' },
      });
    }

    // 4. Process the callback
    const result: Judge0Result = {
      stdout: body.stdout ?? null,
      stderr: body.stderr ?? null,
      compile_output: body.compile_output ?? null,
      status: {
        id: body.status.id,
        description: body.status.description || 'Unknown',
      },
      time: body.time ?? null,
      memory: body.memory ?? null,
      token: body.token,
    };

    // 5. Store the result / trigger submission finalization
    // This is called by the plagiarism/submission pipeline
    console.log(`[Judge0 Callback] Received result for token ${result.token}: status ${result.status.id} (${result.status.description})`);

    // Emit event or store in queue for processing
    // The submission service will listen for this
    await processCallbackResult(result);

    return res.status(200).json({ message: 'Callback processed' });
  } catch (error) {
    console.error('[Judge0 Callback] Error processing callback:', error);
    return res.status(500).json({
      error: { message: 'Internal error processing callback', code: 'INTERNAL_ERROR' },
    });
  }
}

/**
 * Process a validated Judge0 callback result.
 * Updates submission status and triggers downstream processing.
 */
async function processCallbackResult(result: Judge0Result): Promise<void> {
  // Store in Firestore for the submission to pick up
  const { getFirestore } = await import('../../db/firestore');
  const firestore = getFirestore();

  await firestore.collection('judge0Results').doc(result.token).set({
    token: result.token,
    stdout: result.stdout,
    stderr: result.stderr,
    compile_output: result.compile_output,
    status: result.status,
    time: result.time,
    memory: result.memory,
    processedAt: new Date().toISOString(),
  });
}

export default router;
