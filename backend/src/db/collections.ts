export const COLLECTIONS = {
  USERS: 'users',
  COLLEGES: 'colleges',
  CLASSROOMS: 'classrooms',
  TESTS: 'tests',
  SUBMISSIONS: 'submissions',
  /** `${testId}_${uid}`: when a student first entered a test (latched once). */
  ATTEMPTS: 'attempts',
  MONITOR_FLAGS: 'monitorFlags',
  PLAGIARISM_RESULTS: 'plagiarismResults',
} as const;
