import { Request, Response, NextFunction } from 'express';
import { 
  createClassroomService, 
  getClassroomsService, 
  updateClassroomStudentsService 
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

export const updateClassroomStudents = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { classroomId } = req.params;
    const { students, action } = req.body; 
    
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
