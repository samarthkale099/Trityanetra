import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../app';
import { env } from '../../config/env';
import { Role } from '../../types/roles';
import * as admin from 'firebase-admin';
import { COLLECTIONS } from '../../db/collections';

// Every protected route in the API. Add new routes here when they are added to app.ts.
const PROTECTED: Array<[string, string]> = [
  ['post', '/api/auth/assign-role'],
  ['get', '/api/colleges'],
  ['post', '/api/colleges'],
  ['get', '/api/classrooms'],
  ['post', '/api/classrooms'],
  ['post', '/api/classrooms/c1/students'],
  ['get', '/api/tests'],
  ['post', '/api/tests'],
  ['get', '/api/tests/t1/entry'],
  ['post', '/api/submissions'],
  ['post', '/api/submissions/save'],
  ['post', '/api/monitor/t1/flags'],
  ['post', '/api/plagiarism/t1/check'],
  ['get', '/api/plagiarism/t1/status'],
];

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const payload = { uid: 'u1', email: 'u1@x.com', role: Role.STUDENT, collegeId: 'c1' };

const call = (method: string, path: string, authHeader?: string) => {
  const r = (request(app) as any)[method](path);
  if (authHeader !== undefined) r.set('Authorization', authHeader);
  return r.send({});
};

describe('Security: auth bypass', () => {
  const badAuthHeaders: Record<string, string | undefined> = {
    'no Authorization header': undefined,
    'empty Bearer token': 'Bearer ',
    'non-Bearer scheme': 'Basic dXNlcjpwYXNz',
    'garbage token': 'Bearer not.a.jwt',
    'wrong-secret token': `Bearer ${jwt.sign(payload, 'wrong-secret')}`,
    'expired token': `Bearer ${jwt.sign(payload, env.JWT_SECRET, { expiresIn: '-1s' })}`,
    'alg=none unsigned token': `Bearer ${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`,
    'valid STUDENT token with payload tampered to ADMIN': (() => {
      const [h, , sig] = jwt.sign(payload, env.JWT_SECRET).split('.');
      return `Bearer ${h}.${b64url({ ...payload, role: Role.ADMIN })}.${sig}`;
    })(),
  };

  for (const [label, header] of Object.entries(badAuthHeaders)) {
    it(`rejects ${label} with 401 on every protected route`, async () => {
      for (const [method, path] of PROTECTED) {
        const res = await call(method, path, header);
        expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
      }
    });
  }

  it('a valid STUDENT token cannot reach ADMIN/TEACHER-only routes (403)', async () => {
    const token = jwt.sign(payload, env.JWT_SECRET);
    const adminOrTeacherOnly: Array<[string, string]> = [
      ['post', '/api/auth/assign-role'],
      ['get', '/api/colleges'],
      ['post', '/api/colleges'],
      ['post', '/api/classrooms'],
      ['post', '/api/classrooms/c1/students'],
      ['post', '/api/tests'],
      ['post', '/api/plagiarism/t1/check'],
      ['get', '/api/plagiarism/t1/status'],
    ];
    for (const [method, path] of adminOrTeacherOnly) {
      const res = await call(method, path, `Bearer ${token}`);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
    }
  });

  it('a valid TEACHER token cannot reach ADMIN-only or STUDENT-only routes (403)', async () => {
    const token = jwt.sign({ ...payload, role: Role.TEACHER }, env.JWT_SECRET);
    const notForTeacher: Array<[string, string]> = [
      ['post', '/api/auth/assign-role'],
      ['get', '/api/colleges'],
      ['post', '/api/colleges'],
      ['get', '/api/tests/t1/entry'],
      ['post', '/api/submissions'],
      ['post', '/api/submissions/save'],
      ['post', '/api/monitor/t1/flags'],
    ];
    for (const [method, path] of notForTeacher) {
      const res = await call(method, path, `Bearer ${token}`);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
    }
  });

  describe('privilege escalation via registration', () => {
    beforeEach(async () => {
      await admin.firestore().collection(COLLECTIONS.COLLEGES).doc('c1').set({ name: 'C1', code: 'C1' });
    });

    const attempt = (body: object) => request(app).post('/api/auth/register').send(body);

    it('self-registration can never create an ADMIN account (400, no user stored)', async () => {
      for (const role of [Role.ADMIN, 'admin', 'ADMIN ', 'SUPERADMIN', 'ROOT']) {
        const email = `esc-${String(role).trim()}@x.com`;
        const res = await attempt({ email, password: 'password123', role, collegeId: 'c1' });
        expect(res.status, String(role)).toBe(400);
        const snap = await admin.firestore().collection(COLLECTIONS.USERS).where('email', '==', email).get();
        expect(snap.empty, `no user stored for ${String(role)}`).toBe(true);
      }
    });

    it('extra privileged fields in the body are ignored: the stored role is exactly what the schema allows', async () => {
      const res = await attempt({
        email: 'extra-fields@x.com',
        password: 'password123',
        role: Role.STUDENT,
        collegeId: 'c1',
        isAdmin: true,
        admin: true,
        roles: [Role.ADMIN],
      });
      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe(Role.STUDENT);
      const snap = await admin.firestore().collection(COLLECTIONS.USERS).where('email', '==', 'extra-fields@x.com').get();
      const data = snap.docs[0].data();
      expect(data.role).toBe(Role.STUDENT);
      expect(data.isAdmin).toBeUndefined();
      expect(data.admin).toBeUndefined();
      expect(data.roles).toBeUndefined();
    });

    it('self-registration can never create a TEACHER account either (400, no user stored)', async () => {
      const res = await attempt({ email: 'fake-teacher@x.com', password: 'password123', role: Role.TEACHER, collegeId: 'c1' });
      expect(res.status).toBe(400);
      const snap = await admin.firestore().collection(COLLECTIONS.USERS).where('email', '==', 'fake-teacher@x.com').get();
      expect(snap.empty).toBe(true);
    });

    it('STUDENT self-registration still works, but only for a college that exists', async () => {
      const ok = await attempt({ email: 'ok-student@x.com', password: 'password123', role: Role.STUDENT, collegeId: 'c1' });
      expect(ok.status).toBe(201);
      expect(ok.body.user.role).toBe(Role.STUDENT);
      const bad = await attempt({ email: 'ghost-student@x.com', password: 'password123', role: Role.STUDENT, collegeId: 'does-not-exist' });
      expect(bad.status).toBe(400);
    });
  });
});
