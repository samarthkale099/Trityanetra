import { describe, it, expect } from 'vitest';
import { codingAnswerSchema, isCodingAnswer } from '../../modules/submission/submission.schema';

describe('coding answer shape (AST engine contract)', () => {
  it('accepts code with a language and defaults language to python', () => {
    const parsed = codingAnswerSchema.parse({ code: 'print(1)' });
    expect(parsed.language).toBe('python');
    expect(codingAnswerSchema.parse({ code: 'class A{}', language: 'java' }).language).toBe('java');
  });

  it('rejects an empty or missing code', () => {
    expect(codingAnswerSchema.safeParse({ code: '' }).success).toBe(false);
    expect(codingAnswerSchema.safeParse({ language: 'python' }).success).toBe(false);
  });

  it('isCodingAnswer matches the plagiarism worker read (answers.code must be a non-empty string)', () => {
    expect(isCodingAnswer({ code: 'x = 1', language: 'python' })).toBe(true);
    expect(isCodingAnswer({ code: 'x = 1' })).toBe(true); // language optional
    expect(isCodingAnswer({ foo: 'bar' })).toBe(false);
    expect(isCodingAnswer({ code: 123 })).toBe(false);
    expect(isCodingAnswer(null)).toBe(false);
  });
});
