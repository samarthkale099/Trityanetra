import { submitCodeWithBreaker } from './judge0.circuitBreaker';
import { COLLECTIONS } from '../../db/collections';
import { db } from '../../db/firestore';
import { env } from '../../config/env';
import { JUDGE0_LANGUAGE_IDS, isRunnableLanguage, type RunCaseResult, type Judge0Result } from './judge0.types';

const throwError = (message: string, status: number): never => {
  const error: any = new Error(message);
  error.status = status;
  throw error;
};

export const runCodeService = async (code: string, languageId: number) => {
  return await submitCodeWithBreaker(code, languageId);
};

/** Outputs are compared after trimming trailing whitespace on each line and at the end. */
const normalizeOutput = (value: string | null | undefined) =>
  (value ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim();

const MAX_OUTPUT_CHARS = 10_000;
const clip = (value: string | null | undefined) => (value ?? '').slice(0, MAX_OUTPUT_CHARS);

const toCaseResult = (
  caseId: string,
  input: string,
  expected: string | null,
  result: Judge0Result
): RunCaseResult => ({
  caseId,
  input,
  expected,
  stdout: clip(result.stdout),
  stderr: clip(result.stderr ?? result.message),
  compileOutput: clip(result.compile_output),
  status: result.status.description,
  passed: expected === null ? null : result.status.id === 3 && normalizeOutput(result.stdout) === normalizeOutput(expected),
  timeMs: result.time ? Math.round(Number(result.time) * 1000) : null,
  memoryKb: result.memory,
});

/**
 * "Run" during an exam: executes the student's code against the question's
 * VISIBLE test cases (hidden ones are never run here, so their inputs cannot be
 * probed), plus an optional custom input. Nothing is saved; grading happens on
 * the submission. Guards on the route have already checked role, membership,
 * the test window and that the submission is not locked.
 */
export const runForQuestionService = async (input: {
  testId: string;
  questionId: string;
  code: string;
  language: string;
  customInput?: string;
}): Promise<{ results: RunCaseResult[] }> => {
  if (!env.JUDGE0_API_URL || !env.JUDGE0_API_KEY) {
    throwError('Code execution is not configured on this server yet', 503);
  }
  if (!isRunnableLanguage(input.language)) throwError(`Running ${input.language} is not supported`, 400);
  if (typeof input.code !== 'string' || input.code.trim() === '') throwError('Write some code before running it', 400);
  if (input.code.length > 50_000) throwError('Code is too long to run', 400);

  const testDoc = await db.collection(COLLECTIONS.TESTS).doc(input.testId).get();
  if (!testDoc.exists) throwError('Test not found', 404);
  const questions: any[] = Array.isArray(testDoc.data()?.questions) ? testDoc.data()!.questions : [];
  const index = questions.findIndex((q, i) => (q?.id ?? `q${i + 1}`) === input.questionId);
  if (index < 0) throwError('Question not found', 404);

  const languageId = JUDGE0_LANGUAGE_IDS[input.language];
  const visible = (Array.isArray(questions[index].testCases) ? questions[index].testCases : [])
    .map((testCase: any, caseIndex: number) => ({ ...testCase, id: testCase?.id ?? `c${caseIndex + 1}` }))
    .filter((testCase: any) => !testCase.hidden)
    .slice(0, 10);

  const results: RunCaseResult[] = [];
  for (const testCase of visible) {
    const result = await submitCodeWithBreaker(input.code, languageId, String(testCase.input ?? ''));
    results.push(toCaseResult(testCase.id, String(testCase.input ?? ''), String(testCase.expected ?? ''), result));
  }
  if (typeof input.customInput === 'string') {
    const result = await submitCodeWithBreaker(input.code, languageId, input.customInput.slice(0, 10_000));
    results.push(toCaseResult('custom', input.customInput, null, result));
  }
  if (results.length === 0) {
    // No visible cases and no custom input: run once with empty input so the student still sees output.
    const result = await submitCodeWithBreaker(input.code, languageId, '');
    results.push(toCaseResult('custom', '', null, result));
  }
  return { results };
};
