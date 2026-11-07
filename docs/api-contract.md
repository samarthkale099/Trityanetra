# Trityanetra — API contract

The HTTP API the backend (`backend/`) serves and the frontend (`frontend/`) calls.
This describes the code on the `feature/frontend-integration` branch.

Frontend mapping lives in `frontend/src/features/**/*Api.ts`; the browser and unit
test mocks that imitate this API are `frontend/e2e/testBackend.ts` and
`frontend/src/tests/msw/`.

## Conventions

- JSON in and out, all routes under `/api`.
- Auth: `Authorization: Bearer <JWT>` from `POST /api/auth/login`. The token carries
  `uid`, `email`, `displayName`, `role`, `collegeId` and expires after 1 day.
  Everything is authorised from the verified token, never from the request body.
- Roles: `STUDENT`, `TEACHER`, `ADMIN`. "Teacher" below means the owning teacher or an admin.
- Successful payloads are wrapped as `{ data }` (auth routes excepted).
- Errors are `{ error: string }` (route guards) or `{ message, code }` (the central
  error handler). The frontend reads either.
- Another college's classroom/test is reported as **404**, so its existence is not confirmed.
- Timestamps are ISO-8601 strings in UTC.

## Auth

| Method | Path | Who | Body → Response |
|---|---|---|---|
| POST | `/api/auth/register` | anyone | `{ email, password, role: "STUDENT", displayName?, collegeId? }` → `201 { user }` |
| POST | `/api/auth/login` | anyone | `{ email, password }` → `{ token }`; **403 `{ code: "EMAIL_NOT_VERIFIED" }`** until the email is confirmed |
| GET/POST | `/api/auth/verify-email` | anyone (token is the credential) | `?token=` or `{ token }` → 200; 400 if invalid or expired (24 h) |
| POST | `/api/auth/resend-verification` | anyone | `{ email }` → always 200 (never reveals whether the account exists) |
| GET | `/api/auth/me` | signed in | → `{ user: { uid, email, displayName, role, collegeId, createdAt } }` |
| POST | `/api/auth/assign-role` | admin | `{ targetUid, role, collegeId }` |

- Self-registration only ever creates `STUDENT` accounts.
- `collegeId` is optional: a student whose email is on a college's `emailDomain` (or a
  subdomain of it) is placed there automatically; otherwise a `collegeId` is required, and a
  college that has an `emailDomain` only accepts its own domain (403).
- **Email verification**: registration emails a link to `APP_BASE_URL/verify-email?token=…`
  (the frontend's `/verify-email` page). Sign-in is refused until it is opened. Accounts
  created before this feature (no `emailVerified` field) are not affected. Without
  `SMTP_URL` the link is printed in the backend log instead of emailed.
- Emails are stored lower-cased. On registration **and** sign-in, pending classroom
  invites for that email are moved onto the roster.

## Colleges (admin)

| Method | Path | Body → Response |
|---|---|---|
| POST | `/api/colleges` | `{ name, code, emailDomain? }` → `201 { data: { id, name, code, emailDomain } }` (root admin) |
| GET | `/api/colleges` | → `{ data: College[] }` |

## Users (admin)

| Method | Path | Who | Response |
|---|---|---|---|
| GET | `/api/users?email=&role=&collegeId=` | admin | `{ data: [{ uid, email, displayName, role, collegeId, emailVerified, createdAt }] }` |

- Used by the admin **People** page to find someone before `POST /api/auth/assign-role`.
- A college admin only ever sees their own college (a user elsewhere looks like no match);
  a root admin (no `collegeId`) sees every college and may narrow with `collegeId`.
- `email` is an exact, case-insensitive match. Lists are capped at 100. Password hashes and
  verification tokens are never returned.
- A changed role takes effect the next time that person signs in (the role is in their token).

Frontend admin area (`frontend/src/pages/college/`): **People** (`/app/admin/people`) and
**Colleges** (`/app/admin/colleges`), visible to admins only.

## Classrooms

| Method | Path | Who | Body → Response |
|---|---|---|---|
| GET | `/api/classrooms` | any | Teacher: own classrooms with `studentCount`, `invitedCount`, `testCount`. Student: classrooms they were **added to**, with `id, name, subject, description, teacherName, collegeId, createdAt` only — never the roster. |
| POST | `/api/classrooms` | teacher | `{ name, subject?, description?, students?: uid[] }` → `201 { data: { id } }` |
| GET | `/api/classrooms/:id` | teacher | → `{ data: { id, name, subject, description, collegeId, teacherId, createdAt, students: Student[], tests } }` |
| POST | `/api/classrooms/:id/students` | teacher | `{ emails: string[] }` → `201/200 { result, data }` (see below). The original `{ action: "add"\|"remove", students: uid[] }` body still works. |
| DELETE | `/api/classrooms/:id/students/:email` | teacher | → `{ data: ClassroomDetail }`; 404 if not on the roster |

```ts
interface Student { uid: string; email: string; displayName: string; pending: boolean }  // uid "" while pending
interface EnrolmentResult {
  added: string[]            // registered students added now
  invited: string[]          // unregistered emails, linked when they register / sign in
  alreadyEnrolled: string[]  // nothing changed
  rejected: { email: string; reason: string }[]  // not a student, another college, malformed
}
```

## Tests

| Method | Path | Who | Response |
|---|---|---|---|
| POST | `/api/tests` | teacher | Body `{ classroomId, title, startTime, endTime, durationMinutes?, instructions?, language?, questions }` → `201 { data: { id } }` |
| GET | `/api/tests` | any | Student: tests of classrooms they were added to, **without questions**, with `mySubmissionStatus`. Teacher: own tests (full documents) plus `windowStart`, `windowEnd`, `questionCount`, `totalPoints`, `submittedCount`. |
| GET | `/api/tests/:id/lobby` | student (enrolled) | Details, `serverTime`, own `startedAt`/`submission`. **No questions, no timer start, no window check.** |
| GET | `/api/tests/:id/entry` | student (enrolled, window open) | The test with questions; hidden cases masked. **First call latches `startedAt`.** |
| POST | `/api/tests/:id/release` | teacher | Releases marks/comments (idempotent; locks grading) |
| GET | `/api/tests/:id/result` | student | Own result; 404 if they did not submit; marks/comment only after release |

```ts
interface Question {
  id: string                 // e.g. "q1" -- referenced by Run and per-question answers
  prompt: string
  starterCode?: string
  points?: number            // default 10
  testCases: { id: string; input: string; expected: string; hidden: boolean }[]
}
```

Rules:
- **Hidden test cases**: anything a student receives carries hidden cases as
  `{ id, hidden: true, input: null, expected: null }`; reference solutions are stripped.
- **Timer**: the personal deadline is `min(startedAt + durationMinutes, endTime)`.
  Saves and submits after it (plus 30 s grace) are refused **server-side**, so a
  reload or a changed device clock gains nothing.

## Submissions

| Method | Path | Who | Body → Response |
|---|---|---|---|
| POST | `/api/submissions/save` | student | `{ testId, answers }` → draft saved |
| POST | `/api/submissions` | student | `{ testId, answers }` → submitted (one per test+student) |
| GET | `/api/submissions/test/:testId` | teacher | → roster rows: `studentId, studentName, studentEmail, state, submittedAt, marks, maxMarks, flags` |
| GET | `/api/submissions/test/:testId/:studentId` | teacher | → one student's `answers`, `marks`, `comment`, `flags` |
| PUT | `/api/submissions/test/:testId/:studentId/review` | teacher | `{ marks: int \| null, comment }`; 409 after release or if not submitted |

- Guard order on save/submit: role → classroom membership → test window → lock.
  A second submit hits the lock (**403 "locked"**); the frontend treats that as
  "already submitted".
- `answers` is `{ language, code }` when the test has one question (our normal case: one
  test per experiment), and `{ language, questions: { [questionId]: { code } } }` when it has
  several, so no question's code is lost. The plagiarism worker reads both.
- `state` is `SUBMITTED`, `LATE` (after the window) or `NOT_SUBMITTED`.

## Code execution (Piston / Paiza / Judge0)

| Method | Path | Who | Body → Response |
|---|---|---|---|
| POST | `/api/judge0/tests/:testId/run` | student (enrolled, window open) | `{ code, languageId, stdin? }` → `200 { data: { runId, status: "DONE", result } }` (sync) or `202 { data: { runId, status: "PENDING" } }` |
| GET | `/api/judge0/runs/:runId` | the student who started it | → `{ data: { runId, status, result, error } }` |

- `result`: `{ statusId, statusDescription, stdout, stderr, compileOutput, message, time, memory }`
  (`statusId` 3 = Accepted, Judge0 numbering).
- `languageId` (Judge0 CE ids): python 71, javascript 63, java 62, cpp 54, c 50.
- Provider from `CODE_EXECUTION_PROVIDER`: `piston` (free, default), `paiza` (free) or `judge0`.
- Rate limit: 10 runs per minute per student. Nothing is saved as an answer.
- The frontend's Run button runs the question's **visible** test cases (up to 3 per press)
  one at a time and compares each output with the expected output; hidden cases are
  never sent to the browser.

## Monitoring (advisory)

| Method | Path | Who | Body → Response |
|---|---|---|---|
| POST | `/api/monitor/:testId/flags` | student (enrolled) | `{ flagType, metadata? }` → 201. Max 1 per 2 s per student+test. |
| GET | `/api/monitor/:testId/flags` | teacher | → `{ data: { students: [{ studentId, studentName, studentEmail, total, counts, flags }] } }` |

`flagType`: `TAB_SWITCH`, `DEVTOOLS_OPEN`, `PASTE_ATTEMPT`, `FULLSCREEN_EXIT`.
Flags are advisory only: nothing fails or penalises a student automatically.

## Plagiarism (AST engine)

| Method | Path | Who | Response |
|---|---|---|---|
| POST | `/api/plagiarism/:testId/check` | teacher | `202` — queued |
| GET | `/api/plagiarism/:testId/status` | teacher | `{ status, pairs, flagged, summary, skipped, message?, error? }`; 404 if never run |

- Compares every **SUBMITTED** answer of one test with every other (Python only,
  2–50 submissions). One test per experiment gives experiment-wise checking.
- Each pair carries `studentA` / `studentB` (`id`, `name`, `email`), five metrics
  (`cosine_similarity`, `ted_score`, `identifier_overlap`, `operator_overlap`,
  `combined_score`) and `flagLevel`: `high` ≥ 0.80, `medium` ≥ 0.70, `low` ≥ 0.50.
