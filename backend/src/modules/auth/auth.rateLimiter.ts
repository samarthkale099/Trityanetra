import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';
import { rateLimitRedis } from '../../lib/redis';
import { RedisRateLimitStore } from '../../middleware/redisRateLimitStore';

/**
 * Limits on the public auth routes, so a public site cannot be used to guess
 * passwords or spam sign-ups and verification emails. Counts live in Redis
 * (shared by every server instance); tests use the in-memory store.
 *
 * Limits can be raised with env vars for load tests; the defaults suit a
 * real deployment.
 */
const useRedis = process.env.NODE_ENV !== 'test';
const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const ip = (req: Request) => ipKeyGenerator(req.ip ?? '');
const emailOf = (req: Request) =>
  typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
const store = (prefix: string) => (useRedis ? { store: new RedisRateLimitStore(rateLimitRedis as any, prefix) } : {});
const FIFTEEN_MINUTES = 15 * 60_000;
/** Unit tests sign the same accounts in many times; a test opts in with ENABLE_AUTH_RATE_LIMIT. */
const skip = () => process.env.NODE_ENV === 'test' && !process.env.ENABLE_AUTH_RATE_LIMIT;

/** Password guessing against one account: 10 tries per 15 minutes per account and address. */
export const loginRateLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  max: num(process.env.LOGIN_RATE_LIMIT, 10),
  keyGenerator: (req: Request) => `${ip(req)}|${emailOf(req)}`,
  message: { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' },
  skip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  ...store('rl:login:'),
});

/** Mass sign-ups from one address: 10 per hour. */
export const registerRateLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: num(process.env.REGISTER_RATE_LIMIT, 10),
  keyGenerator: ip,
  message: { error: 'Too many accounts created from this network. Try again later.' },
  skip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  ...store('rl:register:'),
});

/** Verification emails: 3 per 15 minutes per account and address, so the mailbox cannot be flooded. */
export const resendRateLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  max: num(process.env.RESEND_RATE_LIMIT, 3),
  keyGenerator: (req: Request) => `${ip(req)}|${emailOf(req)}`,
  message: { error: 'Too many emails requested. Wait 15 minutes and try again.' },
  skip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  ...store('rl:resend:'),
});
