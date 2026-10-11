import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export const validateBody = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = schema.safeParse(req.body);
      if (!result.success) {
        const errorMessages = result.error.issues.map((err: any) => `${err.path.join('.')}: ${err.message}`).join(', ');
        res.status(400).json({ error: errorMessages });
        return;
      }
      req.body = result.data;
      next();
    } catch (e) {
      console.error('ValidateBody Error:', e);
      next(e);
    }
  };
};
