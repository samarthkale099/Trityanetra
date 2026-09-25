import { Request, Response } from 'express';

export class TestController {
  async create(req: Request, res: Response) {
    res.status(201).json({ message: 'Test created (stub)' });
  }

  async list(_req: Request, res: Response) {
    res.json({ tests: [] });
  }

  async getById(req: Request, res: Response) {
    res.json({ test: null });
  }

  async startExam(req: Request, res: Response) {
    res.json({ message: 'Exam started (stub)' });
  }
}

export const testController = new TestController();
