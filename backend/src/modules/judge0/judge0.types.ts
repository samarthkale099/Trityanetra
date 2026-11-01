/**
 * Judge0 language ids for the languages the exam editor offers (Judge0 CE ids).
 * Judge0 supports many more; add a row here to offer one.
 */
export const JUDGE0_LANGUAGE_IDS: Readonly<Record<string, number>> = {
  python: 71, // Python 3
  javascript: 63, // Node.js
  java: 62, // OpenJDK
  cpp: 54, // GCC C++
  c: 50, // GCC C
};

export const isRunnableLanguage = (language: unknown): language is keyof typeof JUDGE0_LANGUAGE_IDS =>
  typeof language === 'string' && language in JUDGE0_LANGUAGE_IDS;

/** What Judge0 returns for one execution (the fields this backend reads). */
export interface Judge0Result {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  /** e.g. { id: 3, description: 'Accepted' }; 5 = time limit, 6 = compile error, 7-12 = runtime errors. */
  status: { id: number; description: string };
  /** Seconds, as a string ("0.012"). */
  time: string | null;
  /** Kilobytes. */
  memory: number | null;
}

/** One run as the student sees it. */
export interface RunCaseResult {
  /** The visible test case id, or "custom" for the student's own input. */
  caseId: string;
  input: string;
  expected: string | null;
  stdout: string;
  stderr: string;
  compileOutput: string;
  status: string;
  /** Only for visible test cases: stdout matched the expected output. */
  passed: boolean | null;
  timeMs: number | null;
  memoryKb: number | null;
}
