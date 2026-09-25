import { Request, Response, NextFunction } from 'express';
import { BODY_SIZE_LIMIT } from '../config/constants';

export function bodySizeLimit(req: Request, res: Response, next: NextFunction) {
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  const maxBytes = parseSize(BODY_SIZE_LIMIT);

  if (contentLength > maxBytes) {
    return res.status(413).json({
      error: { message: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' },
    });
  }
  next();
}

function parseSize(size: string): number {
  const units: Record<string, number> = { b: 1, kb: 1024, mb: 1024 * 1024 };
  const match = size.match(/^(\d+)(b|kb|mb)$/i);
  if (!match) return 1024 * 1024; // default 1MB
  return parseInt(match[1], 10) * (units[match[2].toLowerCase()] || 1);
}
