import { z } from 'zod';

/**
 * Shape of a coding-question answer stored in a submission's `answers`. This is dictated by the AST
 * plagiarism engine's SubmissionInput (ast-engine/app.py): it needs the source `code` and a `language`
 * string. The engine does real AST parsing only for language "python"; any other value falls back to a
 * generic token analysis, so the exact non-python string is not critical.
 *
 * Frontend contract for a coding question:
 *   answers = { code: "<source>", language: "python" | "java" | "cpp" | "c" | "javascript" }
 *
 * OPEN (team): if one test can hold several coding questions, `answers` must key code by question id,
 * and the plagiarism worker (which today reads a single answers.code) would need to pick one per check.
 */
export const codingAnswerSchema = z.object({
  code: z.string().min(1, 'code is required for a coding answer'),
  language: z.string().min(1).default('python'),
  stdin: z.string().optional(),
});

export type CodingAnswer = z.infer<typeof codingAnswerSchema>;

/** True when `answers` carries a usable coding answer (non-empty code). Mirrors the plagiarism worker's check. */
export const isCodingAnswer = (answers: unknown): answers is CodingAnswer =>
  codingAnswerSchema.safeParse(answers).success;
