import dotenv from 'dotenv';
dotenv.config();

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3001', 10),
  
  // Firebase
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '',
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL || '',
  FIREBASE_PRIVATE_KEY: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  
  // Redis
  REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
  
  // Judge0
  JUDGE0_API_URL: process.env.JUDGE0_API_URL || 'http://localhost:2358',
  JUDGE0_API_KEY: process.env.JUDGE0_API_KEY || '',
  JUDGE0_RATE_LIMIT_MAX: parseInt(process.env.JUDGE0_RATE_LIMIT_MAX || '30', 10),
  JUDGE0_RATE_LIMIT_WINDOW_MS: parseInt(process.env.JUDGE0_RATE_LIMIT_WINDOW_MS || '60000', 10),
  JUDGE0_CIRCUIT_BREAKER_THRESHOLD: parseInt(process.env.JUDGE0_CIRCUIT_BREAKER_THRESHOLD || '5', 10),
  JUDGE0_CIRCUIT_BREAKER_RESET_MS: parseInt(process.env.JUDGE0_CIRCUIT_BREAKER_RESET_MS || '30000', 10),
  
  // Monitor
  MONITOR_RATE_LIMIT_MAX: parseInt(process.env.MONITOR_RATE_LIMIT_MAX || '20', 10),
  MONITOR_RATE_LIMIT_WINDOW_MS: parseInt(process.env.MONITOR_RATE_LIMIT_WINDOW_MS || '60000', 10),
  
  // AST Engine
  AST_ENGINE_URL: process.env.AST_ENGINE_URL || 'http://localhost:8000',
  AST_ENGINE_INTERNAL_SECRET: process.env.AST_ENGINE_INTERNAL_SECRET || '',
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  
  // CORS
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
} as const;
