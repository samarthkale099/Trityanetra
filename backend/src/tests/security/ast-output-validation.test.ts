import { describe, it, expect } from 'vitest';
import { PlagiarismResponseSchema } from '../../modules/plagiarism/plagiarism.schema';

// The AST engine is an external service; its output is untrusted input.
const metrics = (over: Record<string, unknown> = {}) => ({
  cosine_similarity: 0.5,
  ted_score: 0.5,
  identifier_overlap: 0.5,
  operator_overlap: 0.5,
  combined_score: 0.5,
  ...over,
});
const pair = (over: Record<string, unknown> = {}) => ({
  submissionA: 'a',
  submissionB: 'b',
  metrics: metrics(),
  flagLevel: 'low',
  ...over,
});
const response = (p: unknown) => ({
  pairs: [p],
  flagged: [],
  summary: { totalSubmissions: 2, totalPairs: 1, flaggedPairs: 0, processingTimeMs: 5 },
});
const ok = (p: unknown) => PlagiarismResponseSchema.safeParse(response(p)).success;

describe('Security: AST output validation', () => {
  it('accepts a well-formed pair', () => {
    expect(ok(pair())).toBe(true);
  });

  it.each(['high', 'medium', 'low', 'none'])('accepts flagLevel %s', (lvl) => {
    expect(ok(pair({ flagLevel: lvl }))).toBe(true);
  });

  it.each(['critical', 'HIGH', '', 'undefined', 5, null])('rejects unknown flagLevel %j', (lvl) => {
    expect(ok(pair({ flagLevel: lvl }))).toBe(false);
  });

  const metricKeys = ['cosine_similarity', 'ted_score', 'identifier_overlap', 'operator_overlap', 'combined_score'];

  it.each(metricKeys)('rejects %s above 1, below 0, NaN, Infinity and numeric strings', (key) => {
    for (const bad of [1.0001, 1.2, -0.1, -1, NaN, Infinity, -Infinity, '0.5', null]) {
      expect(ok(pair({ metrics: metrics({ [key]: bad }) })), `${key}=${String(bad)}`).toBe(false);
    }
  });

  it.each(metricKeys)('accepts %s at the inclusive bounds 0 and 1', (key) => {
    expect(ok(pair({ metrics: metrics({ [key]: 0 }) }))).toBe(true);
    expect(ok(pair({ metrics: metrics({ [key]: 1 }) }))).toBe(true);
  });

  it('rejects a pair with a missing metric', () => {
    const { ted_score, ...rest } = metrics();
    expect(ok(pair({ metrics: rest }))).toBe(false);
  });

  it('rejects a pair with missing submission ids', () => {
    const { submissionA, ...rest } = pair();
    expect(ok(rest)).toBe(false);
  });

  it('rejects a response missing pairs, flagged or summary', () => {
    for (const key of ['pairs', 'flagged', 'summary']) {
      const r: any = response(pair());
      delete r[key];
      expect(PlagiarismResponseSchema.safeParse(r).success, key).toBe(false);
    }
  });

  it('rejects non-object responses', () => {
    for (const bad of [null, undefined, 'ok', 42, []]) {
      expect(PlagiarismResponseSchema.safeParse(bad).success).toBe(false);
    }
  });
});
