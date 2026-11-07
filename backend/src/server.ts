import { app } from './app';
import { env } from './config/env';
import { initPlagiarismQueue } from './modules/plagiarism/plagiarism.queue';
import { initPlagiarismWorker } from './modules/plagiarism/plagiarism.worker';

const PORT = env.PORT;

if (process.env.NODE_ENV !== 'test') {
  initPlagiarismQueue();
  initPlagiarismWorker();

  // 127.0.0.1 locally; containers set HOST=0.0.0.0 so the platform can reach the server.
  const HOST = process.env.HOST || '127.0.0.1';
  app.listen(Number(PORT), HOST, () => {
    console.log(`Server is running on ${HOST}:${PORT}`);
  });
}

export { app };
