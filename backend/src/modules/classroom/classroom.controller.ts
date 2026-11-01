import { Request, Response, NextFunction } from 'express';
import {
  createClassroomService,
  getClassroomsService,
  updateClassroomStudentsService,
  addStudentsByEmailService,
  removeStudentByEmailService,
  getClassroomDetailService,
} from './classroom.service';
import { CLASSROOM_ACTIONS, ClassroomAction } from '../../config/constants';

export const createClassroom = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, students = [] } = req.body;
    const teacherId = req.user?.uid;
    const collegeId = req.user?.collegeId || null;

    const data = await createClassroomService(name, students, teacherId, collegeId);

    res.status(201).json({ message: 'Classroom created successfully', data });
  } catch (error) {
    next(error);
  }
};

export const getClassrooms = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const data = await getClassroomsService(user);

    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};

/** Teacher view of one classroom: roster (registered + invited) and its tests. */
export const getClassroomDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getClassroomDetailService(req.params.classroomId, req.user!);
    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};

/** Removes one student, or a pending invite, by email. Returns the fresh roster. */
export const removeStudentByEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { classroomId, email } = req.params;
    await removeStudentByEmailService(classroomId, decodeURIComponent(email), req.user!);
    const data = await getClassroomDetailService(classroomId, req.user!);
    res.status(200).json({ message: 'Student removed', data });
  } catch (error) {
    next(error);
  }
};

export const updateClassroomStudents = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { classroomId } = req.params;
    const { students, action, emails } = req.body;

    // Enrolment by email: registered students are added, unregistered emails
    // are kept as invites. Returns the per-email outcome and the fresh roster.
    if (Array.isArray(emails)) {
      if (!emails.every((email: unknown) => typeof email === 'string')) {
        return res.status(400).json({ error: 'emails must be a list of strings' });
      }
      const result = await addStudentsByEmailService(classroomId, emails, req.user!);
      const data = await getClassroomDetailService(classroomId, req.user!);
      const status = result.added.length + result.invited.length > 0 ? 201 : 200;
      return res.status(status).json({ message: 'Students updated', result, data });
    }

    if (!students || !Array.isArray(students) || !Object.values(CLASSROOM_ACTIONS).includes(action as ClassroomAction)) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    await updateClassroomStudentsService(
      classroomId,
      students,
      action as ClassroomAction,
      req.user?.uid,
      req.user?.role,
      req.user?.collegeId || null
    );

    res.status(200).json({ message: 'Students updated successfully' });
  } catch (error) {
    next(error);
  }
};
