import { Request, Response, NextFunction } from 'express';
import { createCollegeService, getCollegesService } from './college.service';

export const createCollege = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, code, emailDomain } = req.body;
    const requesterCollegeId = req.user?.collegeId;

    if (typeof name !== 'string' || !name.trim() || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'name and code are required' });
    }

    let domain: string | null = null;
    if (emailDomain !== undefined && emailDomain !== null && emailDomain !== '') {
      if (typeof emailDomain !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(emailDomain.trim())) {
        return res.status(400).json({ error: 'emailDomain must look like "college.edu"' });
      }
      domain = emailDomain.trim().toLowerCase();
    }

    const data = await createCollegeService(requesterCollegeId, name, code, domain);
    
    res.status(201).json({ message: 'College created successfully', data });
  } catch (error) {
    next(error);
  }
};

export const getColleges = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requesterCollegeId = req.user?.collegeId;
    
    const data = await getCollegesService(requesterCollegeId);
    
    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};
