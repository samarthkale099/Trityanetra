import { env } from '../../config/env';
import type { AstSubmission } from './plagiarism.types';

/**
 * HTTP client for the AST engine (Python service). The only place the backend
 * talks to it: authenticated with the shared internal secret, and returns the
 * raw JSON -- the caller validates it against `PlagiarismResponseSchema` before
 * trusting a single field.
 */
export const callAstEngine = async (submissions: AstSubmission[]): Promise<unknown> => {
  if (!env.AST_ENGINE_URL || !env.AST_ENGINE_SECRET) {
    throw new Error('AST_ENGINE_URL or AST_ENGINE_SECRET not configured');
  }

  const response = await fetch(`${env.AST_ENGINE_URL}/api/v1/plagiarism/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': env.AST_ENGINE_SECRET
    },
    body: JSON.stringify({ submissions })
  });

  if (!response.ok) {
    throw new Error(`AST Engine returned ${response.status}`);
  }

  return response.json();
};
