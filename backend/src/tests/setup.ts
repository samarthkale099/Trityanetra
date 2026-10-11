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
