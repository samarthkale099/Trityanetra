module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^ioredis$': '<rootDir>/node_modules/ioredis-mock',
  },
  setupFilesAfterEnv: [],
  testTimeout: 15000,
};
