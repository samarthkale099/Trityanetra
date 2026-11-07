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
  // Optional: a student whose email domain belongs to a college is placed there automatically.
  collegeId: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  displayName: z.string().trim().max(80, "Name is too long").optional(),
});

export const loginSchema = z.object({
  email: z.string().min(1, "Missing email"),
  password: z.string().min(1, "Missing password")
});
