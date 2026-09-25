import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error('[Error]', err.message, err.stack);
  
  const statusCode = (err as any).statusCode || 500;
  const message = env.NODE_ENV === 'production' ? 'Internal server error' : err.message;

  res.status(statusCode).json({
    error: {
      message,
      code: (err as any).errorCode || 'INTERNAL_ERROR',
    },
  });
}
