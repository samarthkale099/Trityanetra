import { z } from 'zod';

// Judge0 puts its own submission token in the body; it becomes a Firestore document id,
// so it must be a plain safe string (no slashes etc.).
export const judge0CallbackSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9-]{1,128}$/, 'invalid judge0 token'),
  status: z.object({
    id: z.number().int(),
    description: z.string().max(200).optional(),
  }),
  stdout: z.string().nullable().optional(),
  stderr: z.string().nullable().optional(),
  compile_output: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  time: z.union([z.string(), z.number()]).nullable().optional(),
  memory: z.number().nullable().optional(),
});

export type Judge0CallbackBody = z.infer<typeof judge0CallbackSchema>;
