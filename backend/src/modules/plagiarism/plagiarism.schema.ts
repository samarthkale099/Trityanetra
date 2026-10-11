import { z } from 'zod';

export const PlagiarismMetricsSchema = z.object({
  cosine_similarity: z.number().min(0).max(1),
  ted_score: z.number().min(0).max(1),
  identifier_overlap: z.number().min(0).max(1),
  operator_overlap: z.number().min(0).max(1),
  combined_score: z.number().min(0).max(1),
});

export const PlagiarismPairSchema = z.object({
  submissionA: z.string(),
  submissionB: z.string(),
  metrics: PlagiarismMetricsSchema,
  flagLevel: z.enum(['high', 'medium', 'low', 'none']),
});

export const PlagiarismSummarySchema = z.object({
  totalSubmissions: z.number(),
  totalPairs: z.number(),
  flaggedPairs: z.number(),
  processingTimeMs: z.number(),
});

export const PlagiarismResponseSchema = z.object({
  pairs: z.array(PlagiarismPairSchema),
  flagged: z.array(PlagiarismPairSchema),
  summary: PlagiarismSummarySchema,
});

export type PlagiarismMetrics = z.infer<typeof PlagiarismMetricsSchema>;
export type PlagiarismPair = z.infer<typeof PlagiarismPairSchema>;
export type PlagiarismSummary = z.infer<typeof PlagiarismSummarySchema>;
export type PlagiarismResponse = z.infer<typeof PlagiarismResponseSchema>;
