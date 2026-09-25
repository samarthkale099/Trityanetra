import { Request, Response } from 'express';

export class CollegeController {
  async create(req: Request, res: Response) {
    // Phase 2 scaffolding - full implementation deferred
    res.status(201).json({ message: 'College created (stub)' });
  }

  async list(_req: Request, res: Response) {
    res.json({ colleges: [] });
  }

  async getById(req: Request, res: Response) {
    res.json({ college: null });
  }
}

export const collegeController = new CollegeController();
