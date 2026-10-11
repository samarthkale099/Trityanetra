import { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[Unhandled Error]:', err);
  
  const status = err.status || err.statusCode || 500;
  const message = (err.status || err.statusCode) 
    ? err.message 
    : 'Internal server error';

  res.status(status).json({ error: message });
};
