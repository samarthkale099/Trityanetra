import { z } from 'zod'
import { deriveCollegeDomain, sanitizeDisplayName, sanitizeEmail } from '@/shared/lib/sanitize'

/**
 * Rejects addresses with an IP-literal domain or no dot, so `user@localhost`
 * and `user@127.0.0.1` cannot pass as a college address.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

const emailSchema = z
  .string()
  .min(1, 'Enter your email address.')
  .max(320, 'That email address is too long.')
  .transform((value) => sanitizeEmail(value))
  .refine((value) => EMAIL_RE.test(value), 'That email address is not formatted correctly.')

/**
 * The college domain is no longer a field the student fills in: it is derived
 * from the address itself (see `deriveCollegeDomain`). What still has to hold
 * is that the part after the `@` is a plausible college hostname — labels of
 * letters, digits and hyphens, no leading or trailing hyphen, at least two of
 * them. `riya@my_college.edu` or `riya@-bad.example` would otherwise become a
 * "college domain" nobody could ever own.
 *
 * PHASE 1 LIMITATION: there is no `colleges` collection or lookup endpoint yet,
 * so this is a format check only, not "is this a known college". The
 * authoritative test must be enforced server-side (see docs/frontend-report.md §8).
 */
const COLLEGE_DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

const registerEmailSchema = emailSchema.refine(
  (value) => COLLEGE_DOMAIN_RE.test(deriveCollegeDomain(value)),
  "We don't recognise that email domain. Use your college email address.",
)

const passwordSchema = z
  .string()
  .min(8, 'Use a password of at least 8 characters.')
  .max(128, 'Use a password of at most 128 characters.')

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
})

export type LoginValues = z.infer<typeof loginSchema>

/**
 * Registration collects exactly what the student types: a name, an address, a
 * password. The college domain is *not* collected — `RegisterForm` derives it
 * from the address with `deriveCollegeDomain` and passes it on in the payload,
 * so there is no second field that can disagree with the address.
 *
 * This is a client-side format check, not a security control: the backend
 * issues the role and would have to re-verify any college rule.
 */
export const registerSchema = z.object({
  displayName: z
    .string()
    .min(1, 'Enter your full name.')
    .max(80, 'Use a name of at most 80 characters.')
    .transform((value) => sanitizeDisplayName(value))
    .refine((value) => value.length >= 2, 'Your name needs at least 2 characters.'),
  email: registerEmailSchema,
  password: passwordSchema,
})

export type RegisterValues = z.infer<typeof registerSchema>

export const passwordResetSchema = z.object({
  email: emailSchema,
})

export type PasswordResetValues = z.infer<typeof passwordResetSchema>
