import { Request, Response } from 'express';

export class ClassroomController {
  async create(req: Request, res: Response) {
    res.status(201).json({ message: 'Classroom created (stub)' });
  }

  async list(_req: Request, res: Response) {
    res.json({ classrooms: [] });
  }

  async getById(req: Request, res: Response) {
    res.json({ classroom: null });
  }

  async addStudent(req: Request, res: Response) {
    res.json({ message: 'Student added (stub)' });
  }
}

export const classroomController = new ClassroomController();
