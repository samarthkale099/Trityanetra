import express from 'express';

import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';

import collegeRoutes from './modules/college/college.routes';
import classroomRoutes from './modules/classroom/classroom.routes';
import testRoutes from './modules/test/test.routes';
import submissionRoutes from './modules/submission/submission.routes';
import authRoutes from './modules/auth/auth.routes';
import monitorRoutes from './modules/monitor/monitor.routes';
import plagiarismRoutes from './modules/plagiarism/plagiarism.routes';
import judge0Routes from './modules/judge0/judge0.routes';
import usersRoutes from './modules/users/users.routes';

const app = express();

import { corsMiddleware } from './middleware/cors';
import { bodySizeLimit } from './middleware/bodySizeLimit';

app.use(requestLogger);

app.use(corsMiddleware);
app.use(bodySizeLimit);

app.use('/api/colleges', collegeRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/monitor', monitorRoutes);
app.use('/api/plagiarism', plagiarismRoutes);
app.use('/api/judge0', judge0Routes);
app.use('/api/users', usersRoutes);

app.use(errorHandler);

export { app };
