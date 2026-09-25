import { Request, Response, NextFunction } from 'express';

type ValidatorFn = (body: any) => { valid: boolean; errors?: string[] };

export function validateBody(validator: ValidatorFn) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = validator(req.body);
    if (!result.valid) {
      return res.status(400).json({
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: result.errors,
        },
      });
    }
    next();
  };
}
