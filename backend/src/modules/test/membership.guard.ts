import { Request, Response, NextFunction } from 'express';
import { Role } from '../../types/roles';
import { COLLECTIONS } from '../../db/collections';
import { db } from '../../db/firestore';
export const testMembershipGuard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const testId = req.params.testId || req.body.testId || req.query.testId;
    const user = req.user;

    if (!testId || !user) {
      return res.status(400).json({ error: 'Missing testId or user' });
    }

    if (user.role === Role.ADMIN) return next();

    const testDoc = await db.collection(COLLECTIONS.TESTS).doc(testId).get();
    if (!testDoc.exists) return res.status(404).json({ error: 'Test not found' });
    const test = testDoc.data();

    if (user.role === Role.TEACHER) {
      if (test?.teacherId !== user.uid) {
        return res.status(403).json({ error: 'Forbidden: You do not own this test' });
      }
      return next();
    }

    if (user.role === Role.STUDENT) {
      const classroomId = test?.classroomId;
      const classroomDoc = await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).get();
      if (!classroomDoc.exists) return res.status(404).json({ error: 'Classroom not found' });
      const classroom = classroomDoc.data();

      // Assuming students array holds student UIDs
      if (!classroom?.students || !classroom.students.includes(user.uid)) {
         return res.status(403).json({ error: 'Forbidden: You are not a member of this test\'s classroom' });
      }
      return next();
    }

    return res.status(403).json({ error: 'Forbidden' });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error checking membership' });
  }
};
