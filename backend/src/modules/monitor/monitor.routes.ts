import { Router, Request, Response } from 'express';
import { monitorService, MonitorFlagType } from './monitor.service';
import { monitorRateLimiter } from './rateLimiter';
import { authenticate } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { ROLES, MONITOR_FLAG_TYPES } from '../../config/constants';

const router = Router();

/**
 * POST /api/monitor/flags
 * Create a new monitor flag.
 * 
 * Authentication: Required (any role — student client reports flags)
 * 
 * Advisory-only: Flag creation has NO side effects beyond storing the flag.
 * 
 * Errors:
 *  - 401: Not authenticated
 *  - 400: Missing required fields or invalid flag type
 *  - 429: Rate limit exceeded
 */
router.post('/flags', authenticate, async (req: Request, res: Response) => {
  try {
    const { submissionId, studentId, testId, type, detail } = req.body;
    const user = (req as any).user;

    // Validate required fields
    if (!submissionId || !testId || !type) {
      return res.status(400).json({
        error: {
          message: 'Missing required fields: submissionId, testId, type',
          code: 'VALIDATION_ERROR',
        },
      });
    }

    // Validate flag type
    const validTypes = Object.values(MONITOR_FLAG_TYPES) as string[];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        error: {
          message: `Invalid flag type. Must be one of: ${validTypes.join(', ')}`,
          code: 'VALIDATION_ERROR',
        },
      });
    }

    // Use authenticated user's ID for studentId (never trust client-sent studentId)
    const actualStudentId = user.uid;

    // Check rate limit
    const rateLimitResult = await monitorRateLimiter.isAllowed(actualStudentId);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        error: {
          message: 'Rate limit exceeded for monitor flags',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfterMs: rateLimitResult.retryAfterMs,
        },
      });
    }

    // Create the flag (advisory-only, append-only)
    const flag = await monitorService.createFlag({
      submissionId,
      studentId: actualStudentId,
      testId,
      type: type as MonitorFlagType,
      detail: detail || '',
    });

    return res.status(201).json({ flag });
  } catch (error) {
    console.error('[Monitor] Error creating flag:', error);
    return res.status(500).json({
      error: { message: 'Failed to create monitor flag', code: 'INTERNAL_ERROR' },
    });
  }
});

/**
 * GET /api/monitor/flags/submission/:submissionId
 * Get all flags for a submission.
 * 
 * Authentication: Required
 * 
 * Errors:
 *  - 401: Not authenticated
 */
router.get('/flags/submission/:submissionId', authenticate, async (req: Request, res: Response) => {
  try {
    const { submissionId } = req.params;
    const flags = await monitorService.getFlagsBySubmission(submissionId);
    return res.json({ flags });
  } catch (error) {
    console.error('[Monitor] Error fetching flags:', error);
    return res.status(500).json({
      error: { message: 'Failed to fetch flags', code: 'INTERNAL_ERROR' },
    });
  }
});

/**
 * GET /api/monitor/flags/test/:testId
 * Get all flags for a test (teacher view).
 * 
 * Authentication: Required (TEACHER or ADMIN role)
 * 
 * Errors:
 *  - 401: Not authenticated
 *  - 403: Not a teacher or admin
 */
router.get(
  '/flags/test/:testId',
  authenticate,
  requireRole(ROLES.TEACHER, ROLES.ADMIN),
  async (req: Request, res: Response) => {
    try {
      const { testId } = req.params;
      const flags = await monitorService.getFlagsByTest(testId);
      return res.json({ flags });
    } catch (error) {
      console.error('[Monitor] Error fetching test flags:', error);
      return res.status(500).json({
        error: { message: 'Failed to fetch test flags', code: 'INTERNAL_ERROR' },
      });
    }
  }
);

/**
 * GET /api/monitor/flags/student/:studentId
 * Get all flags for a student.
 * 
 * Authentication: Required
 * Students can only see their own flags; teachers/admins can see any.
 * 
 * Errors:
 *  - 401: Not authenticated
 *  - 403: Student trying to view another student's flags
 */
router.get('/flags/student/:studentId', authenticate, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params;
    const user = (req as any).user;

    // Students can only see their own flags
    if (user.role === ROLES.STUDENT && user.uid !== studentId) {
      return res.status(403).json({
        error: { message: 'Cannot view another student\'s flags', code: 'FORBIDDEN' },
      });
    }

    const flags = await monitorService.getFlagsByStudent(studentId);
    return res.json({ flags });
  } catch (error) {
    console.error('[Monitor] Error fetching student flags:', error);
    return res.status(500).json({
      error: { message: 'Failed to fetch student flags', code: 'INTERNAL_ERROR' },
    });
  }
});

// IMPORTANT: No PUT, PATCH, or DELETE routes for flags.
// Flags are append-only. If correction is needed, it's a new, separately-reviewed capability.

export default router;
