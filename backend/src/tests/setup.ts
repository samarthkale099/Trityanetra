import { beforeAll, afterEach } from 'vitest';
import * as admin from 'firebase-admin';

// Set up emulator environment variables
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8081';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9100';
process.env.NODE_ENV = 'test';
process.env.PORT = '5001'; // Satisfy env.ts
process.env.JWT_SECRET = 'test-secret'; // Satisfy env.ts
process.env.REDIS_URL = 'redis://localhost:6379'; // Satisfy env.ts
process.env.AST_ENGINE_URL = 'http://localhost:8000'; // Satisfy env.ts
process.env.AST_ENGINE_SECRET = 'secret'; // Satisfy env.ts
process.env.GCLOUD_PROJECT = 'demo-test';

// Neutralize code-execution config so the developer's local .env (e.g. CODE_EXECUTION_PROVIDER=paiza)
// cannot leak into tests. Each test sets exactly the provider/keys it needs. These are set (not deleted)
// so dotenv.config() in env.ts will not re-populate them from .env.
process.env.CODE_EXECUTION_PROVIDER = '';
process.env.JUDGE0_API_URL = '';
process.env.JUDGE0_API_KEY = '';
process.env.JUDGE0_CALLBACK_TOKEN = '';
process.env.JUDGE0_CALLBACK_BASE_URL = '';
process.env.PISTON_API_URL = '';
process.env.PAIZA_API_URL = '';
process.env.PAIZA_API_KEY = '';
process.env.MAX_PLAGIARISM_BATCH_SIZE = '50';

import { vi } from 'vitest';

vi.mock('ioredis', () => {
  return {
    default: class Redis {
      on() {}
      connect() { return Promise.resolve(); }
      disconnect() {}
    }
  };
});

vi.mock('bullmq', () => {
  return {
    Queue: class Queue {
      add() {}
      on() {}
    },
    Worker: class Worker {
      on() {}
      close() {}
    }
  };
});

beforeAll(() => {
  // Initialize admin exactly once
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'demo-test' });
  }
});

afterEach(async () => {
  // Clean up emulator firestore data after each test
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-test/databases/(default)/documents`, {
    method: 'DELETE',
  });

  // Clean up emulator auth data after each test
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/demo-test/accounts`, {
    method: 'DELETE',
  });
});
