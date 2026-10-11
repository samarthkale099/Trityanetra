import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response } from 'express';
import { app } from '../../app'; // The main app to test /api/auth/register and /login
import * as admin from 'firebase-admin';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { authenticateJwt } from '../../modules/auth/jwt.middleware';
import { env } from '../../config/env';

// A mock app for testing the authenticateJwt middleware directly
const mockApp = express();
mockApp.use(express.json());
mockApp.get('/protected', authenticateJwt, (req: Request, res: Response) => {
  res.status(200).json({ user: req.user });
});

describe('Custom JWT Auth Module', () => {
  const db = admin.firestore();

  beforeEach(async () => {
    vi.restoreAllMocks();
    // Registration requires the college to exist.
    await db.collection(COLLECTIONS.COLLEGES).doc('college-1').set({ name: 'College One', code: 'C1' });
  });

  describe('POST /api/auth/register', () => {
    it('should register successfully, return 201, and not include passwordHash', async () => {
      const payload = {
        email: 'test1@example.com',
        password: 'password123',
        role: Role.STUDENT,
        collegeId: 'college-1'
      };

      const res = await request(app)
        .post('/api/auth/register')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('User registered successfully');
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(payload.email);
      expect(res.body.user.passwordHash).toBeUndefined();
    });

    it('should reject duplicate email', async () => {
      const payload = {
        email: 'duplicate@example.com',
        password: 'password123',
        role: Role.STUDENT,
        collegeId: 'college-1'
      };

      // First registration
      await request(app).post('/api/auth/register').send(payload);

      // Second registration
      const res = await request(app)
        .post('/api/auth/register')
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Email already registered');
    });
    it('should reject registration with no email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ password: 'password123', role: Role.STUDENT, collegeId: 'college-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('email');
    });

    it('should reject registration with an invalid role string', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'invalidrole@example.com', password: 'password123', role: 'INVALID_ROLE', collegeId: 'college-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('role');
    });

    it('should reject registration with no collegeId', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'nocollege@example.com', password: 'password123', role: Role.STUDENT });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('collegeId');
    });

    it('should reject self-registration as TEACHER (teachers are promoted by an admin), even with a valid college', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'teacher@example.com', password: 'password123', role: Role.TEACHER, collegeId: 'college-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('role');
      const snap = await db.collection(COLLECTIONS.USERS).where('email', '==', 'teacher@example.com').get();
      expect(snap.empty).toBe(true);
    });

    it('should reject a collegeId that does not exist (400) and store nothing', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'ghost@example.com', password: 'password123', role: Role.STUDENT, collegeId: 'no-such-college' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Unknown collegeId');
      const snap = await db.collection(COLLECTIONS.USERS).where('email', '==', 'ghost@example.com').get();
      expect(snap.empty).toBe(true);
    });

    it('should reject self-registration as ADMIN (privilege escalation), with or without collegeId', async () => {
      for (const extra of [{}, { collegeId: 'college-1' }]) {
        const res = await request(app)
          .post('/api/auth/register')
          .send({ email: 'admin_attempt@example.com', password: 'password123', role: Role.ADMIN, ...extra });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('role');
      }
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return a valid JWT for correct credentials', async () => {
      const payload = {
        email: 'login@example.com',
        password: 'password123',
        role: Role.STUDENT,
        collegeId: 'college-1'
      };

      // Register first
      await request(app).post('/api/auth/register').send(payload);

      // Then login
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: payload.email,
          password: payload.password
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    it('should return the same generic error for wrong password as wrong email', async () => {
      const payload = {
        email: 'wrong@example.com',
        password: 'password123',
        role: Role.STUDENT,
        collegeId: 'college-1'
      };

      await request(app).post('/api/auth/register').send(payload);

      // Wrong email
      const wrongEmailRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123'
        });

      // Wrong password
      const wrongPasswordRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: payload.email,
          password: 'wrongpassword'
        });

      expect(wrongEmailRes.status).toBe(401);
      expect(wrongPasswordRes.status).toBe(401);
      expect(wrongEmailRes.body.error).toBe('Invalid credentials');
      expect(wrongPasswordRes.body.error).toBe('Invalid credentials');
    });
    it('should reject login with no password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'login@example.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('password');
    });
  });

  describe('authenticateJwt Middleware', () => {
    it('should allow access to a protected route with a valid JWT and set req.user', async () => {
      const payload = {
        email: 'jwt@example.com',
        password: 'password123',
        role: Role.STUDENT,
        collegeId: 'college-1'
      };

      await request(app).post('/api/auth/register').send(payload);

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: payload.email,
          password: payload.password
        });

      const token = loginRes.body.token;

      const res = await request(mockApp)
        .get('/protected')
        .set('Authorization', 'Bearer ' + token);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(payload.email);
      expect(res.body.user.role).toBe(payload.role);
      expect(res.body.user.collegeId).toBe(payload.collegeId);
      expect(res.body.user.uid).toBeDefined();
    });
  });
});
