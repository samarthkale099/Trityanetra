import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../app';

describe('Auth rate limits (public site protection)', () => {
  beforeAll(() => {
    process.env.ENABLE_AUTH_RATE_LIMIT = '1';
  });
  afterAll(() => {
    delete process.env.ENABLE_AUTH_RATE_LIMIT;
  });

  const login = (email: string) => request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });

  it('blocks the 11th sign-in attempt on one account within 15 minutes, with a clear message', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await login('target@limit.test')).status).toBe(401);
    }
    const blocked = await login('target@limit.test');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many sign-in attempts/i);
  });

  it('counts each account separately, so one attacked account does not lock out others', async () => {
    expect((await login('someone-else@limit.test')).status).toBe(401);
  });

  it('limits verification emails to 3 per 15 minutes per account', async () => {
    const resend = () => request(app).post('/api/auth/resend-verification').send({ email: 'flood@limit.test' });
    for (let i = 0; i < 3; i++) expect((await resend()).status).toBe(200);
    expect((await resend()).status).toBe(429);
  });
});
