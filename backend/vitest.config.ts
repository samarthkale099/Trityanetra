import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/tests/setup.ts'],
    globals: true,
    fileParallelism: false,
    // The Firebase emulator is slow on its first call; give the cold start room so suites are not flaky.
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
