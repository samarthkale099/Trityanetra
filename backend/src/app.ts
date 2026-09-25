import express from 'express';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { bodySizeLimit } from './middleware/bodySizeLimit';

import authRoutes from './modules/auth/auth.routes';
import collegeRoutes from './modules/college/college.routes';
import classroomRoutes from './modules/classroom/classroom.routes';
import testRoutes from './modules/test/test.routes';
import submissionRoutes from './modules/submission/submission.routes';

// Phase 3 routes — imported dynamically below to avoid circular deps
import judge0CallbackRoutes, { judge0CallbackBodyParser } from './modules/judge0/callback.controller';
import monitorRoutes from './modules/monitor/monitor.routes';
import plagiarismRoutes from './modules/plagiarism/plagiarism.routes';

const app = express();

// Global middleware
app.use(corsMiddleware);
app.use(requestLogger);
app.use(bodySizeLimit);

// Judge0 callback needs the exact raw request bytes for HMAC verification.
// Scoped to this route ONLY and mounted before any other body parsing runs
// on it — every other route keeps its existing body parsing behavior
// (the global express.json below skips already-parsed bodies).
app.use('/api/judge0/callback', judge0CallbackBodyParser);
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Phase 1-2 routes
app.use('/api/auth', authRoutes);
app.use('/api/colleges', collegeRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/submissions', submissionRoutes);

// Phase 3 routes
app.use('/api/judge0', judge0CallbackRoutes);
app.use('/api/monitor', monitorRoutes);
app.use('/api/plagiarism', plagiarismRoutes);

// Error handler (must be last)
app.use(errorHandler);

export default app;
