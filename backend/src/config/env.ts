import dotenv from 'dotenv';

// Load .env into process.env if it exists
dotenv.config();

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`CRITICAL STARTUP ERROR: Missing required environment variable ${key}`);
  }
  return value;
}

export const env = {
  PORT: getEnv('PORT', '5001'),
  JWT_SECRET: getEnv('JWT_SECRET'),
  REDIS_URL: getEnv('REDIS_URL'),
  AST_ENGINE_URL: getEnv('AST_ENGINE_URL'),
  AST_ENGINE_SECRET: getEnv('AST_ENGINE_SECRET'),
  JUDGE0_API_URL: process.env.JUDGE0_API_URL,
  JUDGE0_API_KEY: process.env.JUDGE0_API_KEY,
  JUDGE0_CALLBACK_TOKEN: process.env.JUDGE0_CALLBACK_TOKEN,
  // Public base URL Judge0 can reach us at, e.g. https://api.example.com (no trailing slash needed).
  JUDGE0_CALLBACK_BASE_URL: process.env.JUDGE0_CALLBACK_BASE_URL,
};

if (!env.JUDGE0_API_URL || !env.JUDGE0_API_KEY) {
  console.warn('WARNING: JUDGE0_API_URL and/or JUDGE0_API_KEY missing. Judge0 features will not work.');
}
