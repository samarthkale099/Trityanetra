import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';

describe('GET /api/users (admin user lookup)', () => {
  const db = admin.firestore();
  const root = generateToken({ uid: 'root-1', email: 'root@x.com', role: Role.ADMIN, collegeId: null });
  const mitAdmin = generateToken({ uid: 'adm-mit', email: 'adm@mit.ac.in', role: Role.ADMIN, collegeId: 'mit' });
  const teacher = generateToken({ uid: 't-1', email: 't@mit.ac.in', role: Role.TEACHER, collegeId: 'mit' });
  const lookup = (token: string, query = '') =>
    request(app).get(`/api/users${query}`).set('Authorization', `Bearer ${token}`);

  beforeEach(async () => {
    const users = db.collection(COLLECTIONS.USERS);
    await users.doc('u-riya').set({
      email: 'riya@mit.ac.in', displayName: 'Riya', role: Role.STUDENT, collegeId: 'mit',
      passwordHash: 'secret-hash', emailVerified: true, createdAt: new Date('2026-01-01'),
    });
    await users.doc('u-aditya').set({
      email: 'aditya@mit.ac.in', displayName: 'Aditya', role: Role.TEACHER, collegeId: 'mit', passwordHash: 'h',
    });
    await users.doc('u-other').set({
      email: 'sam@vit.ac.in', displayName: 'Sam', role: Role.STUDENT, collegeId: 'vit', passwordHash: 'h',
      emailVerified: false,
    });
  });

  it('finds a user by email, case-insensitively, without the password hash', async () => {
    const res = await lookup(mitAdmin, '?email=RIYA@mit.ac.in');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        uid: 'u-riya', email: 'riya@mit.ac.in', displayName: 'Riya', role: Role.STUDENT, collegeId: 'mit',
        emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('secret-hash');
  });

  it("never shows a college admin a user from another college", async () => {
    const res = await lookup(mitAdmin, '?email=sam@vit.ac.in');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('lists only the admin\'s own college, filtered by role', async () => {
    const all = await lookup(mitAdmin);
    expect(all.body.data.map((u: any) => u.uid)).toEqual(['u-aditya', 'u-riya']);
    const teachers = await lookup(mitAdmin, '?role=teacher');
    expect(teachers.body.data.map((u: any) => u.uid)).toEqual(['u-aditya']);
  });

  it('lets a root admin search every college, or narrow to one', async () => {
    const other = await lookup(root, '?email=sam@vit.ac.in');
    expect(other.body.data).toHaveLength(1);
    expect(other.body.data[0].emailVerified).toBe(false);
    const vit = await lookup(root, '?collegeId=vit');
    expect(vit.body.data.map((u: any) => u.uid)).toEqual(['u-other']);
  });

  it('treats an account without the verification flag as verified (created before verification existed)', async () => {
    const res = await lookup(mitAdmin, '?email=aditya@mit.ac.in');
    expect(res.body.data[0].emailVerified).toBe(true);
  });

  it('rejects non-admins and bad queries', async () => {
    expect((await lookup(teacher)).status).toBe(403);
    expect((await request(app).get('/api/users')).status).toBe(401);
    expect((await lookup(mitAdmin, '?role=OWNER')).status).toBe(400);
    expect((await lookup(mitAdmin, '?email=not-an-email')).status).toBe(400);
  });
});
