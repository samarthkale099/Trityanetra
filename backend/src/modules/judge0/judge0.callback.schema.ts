import { z } from 'zod';

// Our own run id (a Firestore auto id), taken from the callback URL's ?run= query. It becomes a document
// id, so it must be a plain safe string (no slashes etc.).
export const runIdSchema = z.string().regex(/^[A-Za-z0-9]{1,64}$/, 'invalid run id');

export const judge0CallbackSchema = z.object({
  // Judge0's own token. Informational only: it is not a secret and is not used for lookup.
  token: z.string().max(128).optional(),
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
