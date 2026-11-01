// Shapes of the AST engine's response live as Zod schemas in plagiarism.schema.ts
// (they are validated at runtime); their inferred types are re-exported here.
export type {
  PlagiarismMetrics,
  PlagiarismPair,
  PlagiarismSummary,
  PlagiarismResponse,
} from './plagiarism.schema';

/** One submission as sent to the AST engine. */
export interface AstSubmission {
  id: string;
  code: string;
  language: string;
  studentId: string;
}

/** A compared pair with the two students' identities attached, for the teacher's view. */
export interface NamedPlagiarismPair {
  submissionA: string;
  submissionB: string;
  studentA: { id: string; name: string; email: string };
  studentB: { id: string; name: string; email: string };
  metrics: {
    cosine_similarity: number;
    ted_score: number;
    identifier_overlap: number;
    operator_overlap: number;
    combined_score: number;
  };
  flagLevel: 'high' | 'medium' | 'low' | 'none';
}
