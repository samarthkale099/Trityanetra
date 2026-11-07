/**
 * Seeds the Firestore EMULATOR for the full-stack test (frontend/e2e/fullstack.spec.ts).
 * Refuses to run against a real project: FIRESTORE_EMULATOR_HOST must be set.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 GCLOUD_PROJECT=demo-fullstack npx ts-node --transpile-only scripts/seed-fullstack.ts
 */
import admin from '../src/db/firebase';
import { hashPassword } from '../src/modules/auth/passwordHash.util';

export const FULLSTACK_PASSWORD = 'Fullstack-Pass-42';

async function seed() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('Refusing to seed: FIRESTORE_EMULATOR_HOST is not set (this script is for the emulator only).');
    process.exit(1);
  }
  const db = admin.firestore();
  const passwordHash = await hashPassword(FULLSTACK_PASSWORD);
  const now = new Date();

  await db.collection('colleges').doc('college-mit').set({
    name: 'MIT College of Engineering',
    code: 'MITCOE',
    emailDomain: 'mit.ac.in',
    createdAt: now,
  });

  const users: Array<[string, Record<string, unknown>]> = [
    ['admin-root', { email: 'admin@trityanetra.local', displayName: 'Root Admin', role: 'ADMIN', collegeId: null }],
    ['teacher-aditya', { email: 'aditya@mit.ac.in', displayName: 'Aditya Rao', role: 'TEACHER', collegeId: 'college-mit' }],
    ['student-riya', { email: 'riya@mit.ac.in', displayName: 'Riya Sharma', role: 'STUDENT', collegeId: 'college-mit' }],
    ['student-kabir', { email: 'kabir@mit.ac.in', displayName: 'Kabir Mehta', role: 'STUDENT', collegeId: 'college-mit' }],
    // Same college, never added to the classroom: must not see the test.
    ['student-sam', { email: 'sam@mit.ac.in', displayName: 'Sam Outsider', role: 'STUDENT', collegeId: 'college-mit' }],
    // For the user-acceptance run (e2e/uat.spec.ts):
    ['student-tara', { email: 'tara@mit.ac.in', displayName: 'Tara Iyer', role: 'STUDENT', collegeId: 'college-mit' }],
    ['student-dev', { email: 'dev@mit.ac.in', displayName: 'Dev Patil', role: 'STUDENT', collegeId: 'college-mit' }],
    ['teacher-neha', { email: 'neha@mit.ac.in', displayName: 'Neha Kulkarni', role: 'TEACHER', collegeId: 'college-mit' }],
    ['admin-mit', { email: 'collegeadmin@mit.ac.in', displayName: 'MIT Admin', role: 'ADMIN', collegeId: 'college-mit' }],
    // Another college: its student must never be addable to an MIT classroom.
    ['student-priya', { email: 'priya@vit.ac.in', displayName: 'Priya Rao', role: 'STUDENT', collegeId: 'college-vit' }],
  ];
  await db.collection('colleges').doc('college-vit').set({
    name: 'VIT University',
    code: 'VIT',
    emailDomain: 'vit.ac.in',
    createdAt: now,
  });
  for (const [uid, data] of users) {
    await db.collection('users').doc(uid).set({ ...data, passwordHash, emailVerified: true, createdAt: now });
  }
  console.log(`Seeded 2 colleges and ${users.length} users into the emulator.`);
  process.exit(0);
}

seed().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
