import cors from 'cors';

/**
 * Only these websites may call the API from a browser: CORS_ORIGINS (comma
 * separated, e.g. "https://trityanetra.web.app,https://trityanetra.firebaseapp.com"),
 * plus the local dev servers when CORS_ORIGINS is not set. Requests without an
 * Origin header (same-origin pages, server-to-server calls, tests) are not
 * affected by CORS.
 */
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];

const configured = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const allowed = new Set(configured.length ? configured : DEV_ORIGINS);

export const corsMiddleware = cors({
  origin: (origin, callback) => callback(null, !origin || allowed.has(origin)),
});
