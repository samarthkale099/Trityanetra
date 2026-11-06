import { Request, Response, NextFunction } from 'express';

// The Judge0 callback URL carries a secret (/api/judge0/callback/<token>); never write it to logs.
export const redactSecrets = (url: string): string =>
  url.replace(/(\/judge0\/callback\/)[^/?#\s]+/gi, '$1[redacted]');

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${redactSecrets(req.originalUrl)} - ${res.statusCode} - ${duration}ms`);
  });
  
  next();
};
