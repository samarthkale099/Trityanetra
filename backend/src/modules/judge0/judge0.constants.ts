// Limits for code run through Judge0. Memory limits are in KB (Judge0 CE convention).
export const JUDGE0_BOUNDS = {
  MAX_SOURCE_BYTES: 64 * 1024,
  MAX_STDIN_BYTES: 16 * 1024,
  HTTP_TIMEOUT_MS: 10_000,
  CPU_TIME_LIMIT_S: 5,
  MEMORY_LIMIT_KB: 128_000,
} as const;

// Judge0 CE language ids that students may run. ASSUMPTION: these match the ids on the team's Judge0
// instance (check GET <JUDGE0_API_URL>/languages and edit this list if they differ).
export const ALLOWED_LANGUAGE_IDS: readonly number[] = [
  50, // C (GCC 9.2.0)
  54, // C++ (GCC 9.2.0)
  62, // Java (OpenJDK 13)
  63, // JavaScript (Node.js 12)
  71, // Python (3.8)
];
