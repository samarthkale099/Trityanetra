import { createHash, randomBytes } from 'crypto';

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// The raw token is emailed to the user; only its hash is stored, so a leaked database cannot be used to
// verify accounts. Lookup is by hash (not a secret on its own); the raw token is the secret.
export const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

export const generateVerificationToken = (): { raw: string; tokenHash: string; expiresAt: Date } => {
  const raw = randomBytes(32).toString('hex');
  return { raw, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) };
};
