import cors from 'cors';

// TODO: Currently allows all origins. MUST be restricted to specific origins before any deployment beyond local development.
export const corsMiddleware = cors();
