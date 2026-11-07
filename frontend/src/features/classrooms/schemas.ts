import { z } from 'zod'
import { sanitizeText } from '@/shared/lib/sanitize'
import { parseIstInputMs } from '@/shared/lib/datetime'
import { EXAM_LANGUAGES } from '@/shared/types/classroom'

/**
 * Form schemas for the teacher surfaces.
 *
 * Client-side validation is a UX affordance only. Every rule here is a rule the
 * backend must re-check: the mock in `src/tests/msw/classroomHandlers.ts`
 * deliberately duplicates the structural ones (non-empty title, `end > start`,
 * at least one question) so a frontend-only rule cannot quietly become the only
 * rule.
 */

/**
 * Sanitizing wrapper. Every `trimmed` field is `string` in and `string` out, so
 * the schema's input and output types stay identical. That matters: react-hook-
 * form's `zodResolver` pairing is only sound when `z.input` and `z.output`
 * coincide, and a `string | undefined -> string` transform silently breaks
 * `useForm<Values>` inference. Optional text is therefore `''`-defaulted by the
 * form rather than `.optional()` in the schema.
 */
const trimmed = (max: number, message: string) =>
  z
    .string()
    .min(1, message)
    .max(max, `Use at most ${max} characters.`)
    .transform((value) => sanitizeText(value, max))

/** Same type-preserving rule as `trimmed`, but an empty string is allowed. */
const optionalText = (max: number, message: string) =>
  z.string().max(max, message).transform((value) => sanitizeText(value, max))

export const createClassroomSchema = z.object({
  name: trimmed(120, 'Give the classroom a name.'),
  subject: trimmed(80, 'Name the subject or course code.'),
  description: optionalText(500, 'Use at most 500 characters.'),
})

export type CreateClassroomValues = z.infer<typeof createClassroomSchema>

/** One question in the test builder. */
export const testQuestionSchema = z.object({
  prompt: trimmed(2000, 'Write the question prompt.'),
  starterCode: optionalText(20_000, 'That starter code is too long.'),
  points: z
    .number({ invalid_type_error: 'Give the question a points value.' })
    .int('Points must be a whole number.')
    .min(1, 'A question must be worth at least 1 point.')
    .max(1000, 'A question cannot be worth more than 1000 points.'),
})

export type TestQuestionValues = z.infer<typeof testQuestionSchema>

const durationSchema = z
  .number({ invalid_type_error: 'Set how long the exam runs.' })
  .int('Duration must be a whole number of minutes.')
  .min(1, 'The exam must run for at least 1 minute.')
  .max(480, 'The exam cannot run for more than 480 minutes.')

/**
 * `datetime-local` yields `YYYY-MM-DDTHH:mm` with no zone. It is read as IST
 * rather than the computer's own zone, so the same wall-clock the teacher types
 * means the same instant on every machine. The cross-field check compares the
 * two as instants.
 */
const localDateTimeSchema = z
  .string()
  .min(1, 'Set this time.')
  .refine((value) => parseIstInputMs(value) !== null, 'Enter a valid date and time.')

export const createTestSchema = z
  .object({
    title: trimmed(120, 'Give the test a title.'),
    instructions: optionalText(1000, 'Use at most 1000 characters.'),
    language: z.enum(EXAM_LANGUAGES, { errorMap: () => ({ message: 'Choose a language.' }) }),
    /** Value of the `datetime-local` inputs, read as IST. */
    windowStartLocal: localDateTimeSchema,
    windowEndLocal: localDateTimeSchema,
    durationMinutes: durationSchema,
    questions: z
      .array(testQuestionSchema)
      .min(1, 'Add at least one question.')
      .max(50, 'A test can hold at most 50 questions.'),
  })
  .refine((value) => (parseIstInputMs(value.windowEndLocal) ?? 0) > (parseIstInputMs(value.windowStartLocal) ?? 0), {
    path: ['windowEndLocal'],
    message: 'The window must end after it starts.',
  })
  .refine(
    (value) => {
      const start = parseIstInputMs(value.windowStartLocal)
      const end = parseIstInputMs(value.windowEndLocal)
      if (start === null || end === null) return false
      const spanMinutes = (end - start) / 60_000
      // The per-attempt allowance has to fit inside the window, or a student
      // would be cut off mid-question by the duration rather than by the window.
      return value.durationMinutes <= spanMinutes
    },
    {
      path: ['durationMinutes'],
      message: 'The exam duration must fit inside the test window.',
    },
  )

export type CreateTestValues = z.infer<typeof createTestSchema>

/** The most addresses one "Add students" paste may carry. */
export const MAX_STUDENTS_PER_ADD = 200

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Splits a pasted block of addresses -- separated by commas, semicolons,
 * spaces or new lines, as copied from a spreadsheet or an email client -- into
 * unique, lower-cased emails. Order is kept so the roster reads as pasted.
 */
export function parseEmailList(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().replace(/^<|>$/g, '').toLowerCase()
    if (email) seen.add(email)
  }
  return [...seen]
}

/** "Add students": one or more emails in a single textarea. */
export const addStudentsSchema = z.object({
  emails: z
    .string()
    .max(20_000, 'That list is too long. Add students in smaller batches.')
    .superRefine((value, ctx) => {
      const emails = parseEmailList(value)
      if (emails.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter at least one student email.' })
        return
      }
      if (emails.length > MAX_STUDENTS_PER_ADD) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Add at most ${MAX_STUDENTS_PER_ADD} students at a time.`,
        })
        return
      }
      const invalid = emails.filter((email) => !EMAIL_SHAPE.test(email))
      if (invalid.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${invalid.length === 1 ? 'This is' : 'These are'} not a valid email: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '…' : ''}`,
        })
      }
    }),
})

export type AddStudentsValues = z.infer<typeof addStudentsSchema>
