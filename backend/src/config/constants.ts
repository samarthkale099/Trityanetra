export const ROLES = {
  STUDENT: 'STUDENT',
  TEACHER: 'TEACHER',
  ADMIN: 'ADMIN',
} as const;

export type UserRole = typeof ROLES[keyof typeof ROLES];

export const COLLECTIONS = {
  USERS: 'users',
  COLLEGES: 'colleges',
  CLASSROOMS: 'classrooms',
  TESTS: 'tests',
  QUESTIONS: 'questions',
  SUBMISSIONS: 'submissions',
  MONITOR_FLAGS: 'monitorFlags',
  PLAGIARISM_JOBS: 'plagiarismJobs',
  PLAGIARISM_RESULTS: 'plagiarismResults',
} as const;

export const SUBMISSION_STATUS = {
  DRAFT: 'DRAFT',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  FINALIZED: 'FINALIZED',
  EXECUTION_UNAVAILABLE: 'EXECUTION_UNAVAILABLE',
  TIMED_OUT: 'TIMED_OUT',
  FAILED: 'FAILED',
} as const;

export type SubmissionStatus = typeof SUBMISSION_STATUS[keyof typeof SUBMISSION_STATUS];

/**
 * Plagiarism job status — EXACTLY these four values (no PENDING, no TIMED_OUT).
 * Any other value is rejected by plagiarismService.updateJobStatus.
 */
export const PLAGIARISM_JOB_STATUS = {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type PlagiarismJobStatus = typeof PLAGIARISM_JOB_STATUS[keyof typeof PLAGIARISM_JOB_STATUS];

export const PLAGIARISM_FLAG_LEVEL = {
  NONE: 'none',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;

export const MONITOR_FLAG_TYPES = {
  TAB_SWITCH: 'TAB_SWITCH',
  PASTE_ATTEMPT: 'PASTE_ATTEMPT',
  FULLSCREEN_EXIT: 'FULLSCREEN_EXIT',
  DEVTOOLS_OPEN: 'DEVTOOLS_OPEN',
} as const;

/**
 * Bounds for Judge0 requests (execution time, request size, output size).
 * Every bound is enforced in code and covered by boundary tests.
 */
export const JUDGE0_BOUNDS = {
  /** Max source_code size in bytes (request size bound). */
  MAX_SOURCE_BYTES: 65536,
  /** Max stdin size in bytes (request size bound). */
  MAX_STDIN_BYTES: 16384,
  /** Max characters allowed in stdout/stderr/compile_output (output size bound). */
  MAX_OUTPUT_CHARS: 100000,
  /** HTTP request timeout to Judge0 in ms (execution time bound). */
  HTTP_TIMEOUT_MS: 30000,
  /** Default cpu_time_limit sent to Judge0, in seconds (execution time bound). */
  DEFAULT_CPU_TIME_LIMIT_S: '5',
  /** Default memory_limit sent to Judge0, in MB. */
  DEFAULT_MEMORY_LIMIT_MB: '256',
  /** Maximum allowed cpu_time_limit, in seconds. */
  MAX_CPU_TIME_LIMIT_S: 10,
  /** Maximum allowed memory_limit, in MB. */
  MAX_MEMORY_LIMIT_MB: 1024,
  /** Max total wait for a result before TIMED_OUT (execution time bound). */
  MAX_WAIT_MS: 30000,
} as const;

export const BODY_SIZE_LIMIT = '1mb';
