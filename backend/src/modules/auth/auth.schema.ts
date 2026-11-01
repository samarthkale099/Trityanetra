import { z } from 'zod';
import { Role } from '../../types/roles';

export const registerSchema = z.object({
  email: z.string().min(1, "Missing email"),
  password: z.string().min(1, "Missing password"),
  // SECURITY: self-registration only ever creates STUDENT accounts.
  // TEACHER accounts are promoted by an admin via POST /api/auth/assign-role, and ADMIN accounts are
  // seeded with scripts/bootstrap-admin.ts or granted by a root admin. Never user-chosen at signup.
  role: z.string().refine((r) => r === Role.STUDENT, {
    message: "Only STUDENT accounts can self-register; TEACHER and ADMIN accounts are assigned by an admin"
  }),
  // Optional: when omitted, the college is found from the email's domain
  // (colleges carry an `emailDomain`). Registration still fails if neither works.
  collegeId: z.string().min(1).optional(),
  displayName: z.string().trim().max(80, "Name is too long").optional(),
});

export const loginSchema = z.object({
  email: z.string().min(1, "Missing email"),
  password: z.string().min(1, "Missing password")
});
