import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { CLASSROOM_ACTIONS } from '../../config/constants';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';
import { env } from '../../config/env';
import jwt from 'jsonwebtoken';

describe('Classroom Module', () => {
  const db = admin.firestore();

  beforeEach(async () => {
    vi.restoreAllMocks();
  });

  describe('JWT Authentication', () => {
    it('should reject a request with a JWT signed using the wrong secret', async () => {
      const wrongSecretToken = jwt.sign({ uid: 'user-1', email: 'test@example.com', role: Role.TEACHER, collegeId: null }, 'wrong-secret');
      
      const res = await request(app)
        .get('/api/classrooms')
        .set('Authorization', `Bearer ${wrongSecretToken}`);
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: Invalid or expired token');
    });

    it('should reject a request with an expired JWT', async () => {
      const expiredToken = jwt.sign({ uid: 'user-1', email: 'test@example.com', role: Role.TEACHER, collegeId: null }, env.JWT_SECRET, { expiresIn: '-1s' });
      
      const res = await request(app)
        .get('/api/classrooms')
        .set('Authorization', `Bearer ${expiredToken}`);
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: Invalid or expired token');
    });
  });

  describe('POST /api/classrooms', () => {
    it('should allow a TEACHER to create a classroom and inherit their collegeId', async () => {
      const teacherUid = 'teacher-1';
      const myCollegeId = 'college-A';
      
      await db.collection(COLLECTIONS.USERS).doc(teacherUid).set({
        role: Role.TEACHER,
        collegeId: myCollegeId
      });

      const token = generateToken({
        uid: teacherUid,
        email: 'teacher1@college.com',
        role: Role.TEACHER,
        collegeId: myCollegeId
      });

      const res = await request(app)
        .post('/api/classrooms')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Math 101', students: [] });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Classroom created successfully');
      expect(res.body.data.id).toBeTruthy();
      
      const classroomDoc = await db.collection(COLLECTIONS.CLASSROOMS).doc(res.body.data.id).get();
      expect(classroomDoc.exists).toBe(true);
      expect(classroomDoc.data()?.collegeId).toBe(myCollegeId);
    });

    it('should reject with 400 if a student UID in the list is not a STUDENT role', async () => {
      const teacherUid = 'teacher-2';
      const myCollegeId = 'college-A';
      const otherTeacherUid = 'teacher-3';
      
      await db.collection(COLLECTIONS.USERS).doc(teacherUid).set({ role: Role.TEACHER, collegeId: myCollegeId });
      await db.collection(COLLECTIONS.USERS).doc(otherTeacherUid).set({ role: Role.TEACHER, collegeId: myCollegeId }); // NOT a student

      const token = generateToken({
        uid: teacherUid,
        email: 'teacher2@college.com',
        role: Role.TEACHER,
        collegeId: myCollegeId
      });

      const res = await request(app)
        .post('/api/classrooms')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Science 101', students: [otherTeacherUid] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/is not a STUDENT/i);
    });

    it('should reject with 400 if a student UID is from a different college', async () => {
      const teacherUid = 'teacher-4';
      const myCollegeId = 'college-A';
      const studentUid = 'student-wrong-college';
      
      await db.collection(COLLECTIONS.USERS).doc(teacherUid).set({ role: Role.TEACHER, collegeId: myCollegeId });
      await db.collection(COLLECTIONS.USERS).doc(studentUid).set({ role: Role.STUDENT, collegeId: 'college-B' });

      const token = generateToken({
        uid: teacherUid,
        email: 'teacher4@college.com',
        role: Role.TEACHER,
        collegeId: myCollegeId
      });

      const res = await request(app)
        .post('/api/classrooms')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'History 101', students: [studentUid] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/does not belong to this college/i);
    });
  });

  describe('GET /api/classrooms', () => {
    it('should only return classrooms where the STUDENT is in the students array', async () => {
      const studentUid = 'student-1';
      const myCollegeId = 'college-A';
      
      await db.collection(COLLECTIONS.USERS).doc(studentUid).set({
        role: Role.STUDENT,
        collegeId: myCollegeId
      });

      // Classroom with this student
      await db.collection(COLLECTIONS.CLASSROOMS).doc('class-yes').set({
        name: 'Math 101',
        collegeId: myCollegeId,
        teacherId: 'teacher-x',
        students: [studentUid]
      });

      // Classroom without this student
      await db.collection(COLLECTIONS.CLASSROOMS).doc('class-no').set({
        name: 'Science 101',
        collegeId: myCollegeId,
        teacherId: 'teacher-y',
        students: ['some-other-student']
      });

      const token = generateToken({
        uid: studentUid,
        email: 'student1@college.com',
        role: Role.STUDENT,
        collegeId: myCollegeId
      });

      const res = await request(app)
        .get('/api/classrooms')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe('class-yes');
    });
  });

  describe('POST /api/classrooms/:classroomId/students', () => {
    it('should reject a non-owning TEACHER with 403', async () => {
      const teacherUid = 'teacher-not-owner';
      const myCollegeId = 'college-A';
      const classroomId = 'class-owned-by-someone-else';
      
      await db.collection(COLLECTIONS.USERS).doc(teacherUid).set({ role: Role.TEACHER, collegeId: myCollegeId });
      
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).set({
        name: 'Art 101',
        collegeId: myCollegeId,
        teacherId: 'some-other-teacher', // Different teacher
        students: []
      });

      const token = generateToken({
        uid: teacherUid,
        email: 'teacher.notowner@college.com',
        role: Role.TEACHER,
        collegeId: myCollegeId
      });

      const res = await request(app)
        .post(`/api/classrooms/${classroomId}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: CLASSROOM_ACTIONS.ADD, students: ['student-x'] });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Forbidden: You do not own this classroom/i);
    });

    it('should add a student without duplicating if already present', async () => {
      const teacherUid = 'teacher-owner';
      const myCollegeId = 'college-A';
      const classroomId = 'class-my-own';
      const studentUid = 'student-2';
      
      await db.collection(COLLECTIONS.USERS).doc(teacherUid).set({ role: Role.TEACHER, collegeId: myCollegeId });
      await db.collection(COLLECTIONS.USERS).doc(studentUid).set({ role: Role.STUDENT, collegeId: myCollegeId });
      
      // Classroom already has the student
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).set({
        name: 'Gym 101',
        collegeId: myCollegeId,
        teacherId: teacherUid,
        students: [studentUid]
      });

      const token = generateToken({
        uid: teacherUid,
        email: 'teacher.owner@college.com',
        role: Role.TEACHER,
        collegeId: myCollegeId
      });

      const res = await request(app)
        .post(`/api/classrooms/${classroomId}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: CLASSROOM_ACTIONS.ADD, students: [studentUid] });

      expect(res.status).toBe(200);
      
      const classroomDoc = await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).get();
      const studentsArray = classroomDoc.data()?.students || [];
      expect(studentsArray.length).toBe(1); // Still 1, no duplicate
      expect(studentsArray[0]).toBe(studentUid);
    });

    it('should correctly remove a student via arrayRemove', async () => {
      const teacherUid = 'teacher-owner-2';
      const myCollegeId = 'college-A';
      const classroomId = 'class-to-remove-from';
      const studentUid = 'student-3';
      
      await db.collection(COLLECTIONS.USERS).doc(teacherUid).set({ role: Role.TEACHER, collegeId: myCollegeId });
      
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).set({
        name: 'Music 101',
        collegeId: myCollegeId,
        teacherId: teacherUid,
        students: [studentUid, 'some-other-student']
      });

      const token = generateToken({
        uid: teacherUid,
        email: 'teacher.owner2@college.com',
        role: Role.TEACHER,
        collegeId: myCollegeId
      });

      const res = await request(app)
        .post(`/api/classrooms/${classroomId}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: CLASSROOM_ACTIONS.REMOVE, students: [studentUid] });

      expect(res.status).toBe(200);
      
      const classroomDoc = await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).get();
      const studentsArray = classroomDoc.data()?.students || [];
      expect(studentsArray.length).toBe(1);
      expect(studentsArray).not.toContain(studentUid);
      expect(studentsArray).toContain('some-other-student');
    });
  });
});
