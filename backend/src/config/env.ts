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
  // Which engine runs student code: 'piston' (free, no key, default) or 'judge0'.
  CODE_EXECUTION_PROVIDER: process.env.CODE_EXECUTION_PROVIDER,
  // Piston API base (default is the free public instance).
  PISTON_API_URL: process.env.PISTON_API_URL,
  // Public base URL Judge0 can reach us at, e.g. https://api.example.com (no trailing slash needed).
  JUDGE0_CALLBACK_BASE_URL: process.env.JUDGE0_CALLBACK_BASE_URL,
  // Public URL of the frontend, used to build email-verification links. Defaults to localhost in dev.
  APP_BASE_URL: process.env.APP_BASE_URL || 'http://localhost:3000',
  // SMTP connection string (e.g. smtps://user:pass@smtp.host:465). If unset, verification emails are
  // not actually sent: in dev the link is logged to the server console instead.
  SMTP_URL: process.env.SMTP_URL,
  // From address for outgoing mail.
  MAIL_FROM: process.env.MAIL_FROM || 'Trityanetra <no-reply@trityanetra.local>',
};

if (!env.JUDGE0_API_URL || !env.JUDGE0_API_KEY) {
  console.warn('WARNING: JUDGE0_API_URL and/or JUDGE0_API_KEY missing. Judge0 features will not work.');
}
