import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { runCodeService, getRunService } from './judge0.service';

const runBodySchema = z.object({
  code: z.string().min(1),
  languageId: z.number().int(),
  stdin: z.string().optional(),
});

export const runCode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = runBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'code (string) and languageId (integer) are required' });
    }
    const { code, languageId, stdin } = parsed.data;
    const data = await runCodeService(req.user!, req.params.testId, code, languageId, stdin);
    // Sync mode returns the finished result (200); async mode returns a pending run to poll (202).
    res.status(data.status === 'DONE' ? 200 : 202).json({ data });
  } catch (error) {
    next(error);
  }
};

export const getRun = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getRunService(req.user!, req.params.runId);
    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};
