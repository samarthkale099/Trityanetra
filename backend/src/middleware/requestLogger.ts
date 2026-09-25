import { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, _res: Response, next: NextFunction) {
  const start = Date.now();
  
  _res.on('finish', () => {
    const duration = Date.now() - start;
    const log = `[${req.method}] ${req.originalUrl} ${_res.statusCode} ${duration}ms`;
    if (_res.statusCode >= 500) {
      console.error(log);
    } else if (_res.statusCode >= 400) {
      console.warn(log);
    } else {
      console.log(log);
    }
  });
  
  next();
}
