import { app } from './app';
import { env } from './config/env';
import { initPlagiarismQueue } from './modules/plagiarism/plagiarism.queue';
import { initPlagiarismWorker } from './modules/plagiarism/plagiarism.worker';

const PORT = env.PORT;

if (process.env.NODE_ENV !== 'test') {
  initPlagiarismQueue();
  initPlagiarismWorker();

  app.listen(Number(PORT), '127.0.0.1', () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

export { app };
