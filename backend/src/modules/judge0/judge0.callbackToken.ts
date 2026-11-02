import { createHash, timingSafeEqual } from 'crypto';

/**
 * Checks the secret that Judge0 sends back in the callback URL (/api/judge0/callback/<token>).
 * - Fails closed: if no token is configured (or it is empty), nothing is ever accepted.
 * - Constant time: both sides are hashed first, so the buffers always have the same length
 *   (timingSafeEqual throws on different lengths) and no length or prefix information leaks.
 */
export const verifyCallbackToken = (provided: unknown, expected: string | undefined): boolean => {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  if (!expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
};
