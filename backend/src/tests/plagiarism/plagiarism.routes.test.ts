import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import * as admin from 'firebase-admin';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';

vi.mock('../../modules/plagiarism/plagiarism.service', () => ({
  triggerPlagiarismCheck: vi.fn(),
  getPlagiarismStatus: vi.fn().mockResolvedValue({ status: 'COMPLETED', message: 'test' })
}));

describe('Plagiarism API & Ownership', () => {
  const db = admin.firestore();

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  const setupTestDoc = async (testId: string, teacherId: string, collegeId: string) => {
    await db.collection(COLLECTIONS.TESTS).doc(testId).set({
      teacherId,
      collegeId
    });
  };

  it('another teacher gets 403', async () => {
    await setupTestDoc('test-owner', 'teacher1', 'college1');
    const token = generateToken({ uid: 'teacher2', email: 't@t.com', role: Role.TEACHER, collegeId: 'college1' });
    
    const res = await request(app)
      .post('/api/plagiarism/test-owner/check')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/You do not own this test/i);
  });

  it('a teacher from another college gets 403', async () => {
    await setupTestDoc('test-col', 'teacher1', 'college1');
    const token = generateToken({ uid: 'teacher1', email: 't@t.com', role: Role.TEACHER, collegeId: 'college2' });
    
    const res = await request(app)
      .get('/api/plagiarism/test-col/status')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Test belongs to a different college/i);
  });

  it('the owner succeeds', async () => {
    await setupTestDoc('test-success', 'teacher1', 'college1');
    const token = generateToken({ uid: 'teacher1', email: 't@t.com', role: Role.TEACHER, collegeId: 'college1' });
    
    const res = await request(app)
      .post('/api/plagiarism/test-success/check')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(202);
  });

  it('an unknown testId gets 404', async () => {
    const token = generateToken({ uid: 'teacher1', email: 't@t.com', role: Role.TEACHER, collegeId: 'college1' });
    
    const res = await request(app)
      .post('/api/plagiarism/unknown-test/check')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(404);
  });
});
