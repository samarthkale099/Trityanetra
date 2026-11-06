import { Request, Response, NextFunction } from 'express';
import { createCollegeService, getCollegesService, setCollegeEmailDomainService } from './college.service';

export const createCollege = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, code, emailDomain } = req.body;
    const requesterCollegeId = req.user?.collegeId;

    if (typeof name !== 'string' || !name.trim() || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'name and code are required' });
    }

    const data = await createCollegeService(requesterCollegeId, name, code, emailDomain);
    
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

export const setCollegeEmailDomain = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { emailDomain } = req.body;
    if (emailDomain !== null && typeof emailDomain !== 'string') {
      return res.status(400).json({ error: 'emailDomain must be a string, or null to clear it' });
    }
    const data = await setCollegeEmailDomainService(req.user?.collegeId, req.params.collegeId, emailDomain);
    res.status(200).json({ message: 'College email domain updated', data });
  } catch (error) {
    next(error);
  }
};
