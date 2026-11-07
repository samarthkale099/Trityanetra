# Testing Trityanetra

Every suite also runs automatically on GitHub for each pull request
(`.github/workflows/ci.yml`). A red check means: do not merge.

| Suite | What it covers | Run it |
|---|---|---|
| Backend | Every API route against the Firestore emulator: auth and email verification, enrolment, exam timer, grading, monitoring, plagiarism queue, code runner, security, admin lookup | `cd backend` then `npm test` (needs Java 21) |
| Frontend unit | Every screen and API mapping, against a mock server (MSW) | `cd frontend` then `npm test` |
| Frontend browser | Real clicks in a browser against a stubbed API: sign-in, exam, anti-cheat, classrooms, grading, results, admin | `cd frontend` then `npx playwright test --project=chromium e2e/auth.spec.ts e2e/exam.spec.ts e2e/classrooms.spec.ts e2e/review.spec.ts e2e/result.spec.ts e2e/field-states.spec.ts e2e/admin.spec.ts` |
| AST engine | Plagiarism metrics, golden cases, adversarial cases, API | `cd ast-engine` then `python -m pytest tests -q` |
| **Full stack** | One complete exam with **nothing stubbed**: real backend, Firestore emulator, Redis, AST engine and the frontend | see below |

## Full-stack integration test

`frontend/e2e/fullstack.spec.ts` walks one exam end to end:

1. A new student registers, is refused until the email is verified, opens the link, signs in.
2. The teacher creates a classroom, adds students by email and sets a Python test.
3. A student from the same college who was **not** added cannot see or open the test (server returns 403).
4. Riya sits the exam: fullscreen, runs her code, leaves the tab once (flagged), submits.
5. Kabir submits a near-identical program.
6. The teacher sees Riya's integrity flag, runs the plagiarism check (Redis queue, worker, AST engine) and gets the Riya/Kabir pair, grades Riya and releases results.
7. Riya sees her released marks and comment.
8. The admin makes the new student a teacher; it applies at their next sign-in.

It runs in CI on every pull request. To run it locally you need Java 21, Python 3.11
with `ast-engine/requirements.txt` installed (a `.venv` in `ast-engine/` is picked up),
and Redis on port 6379:

```bash
docker run -d --name trityanetra-redis -p 6379:6379 redis:7-alpine
```
```bash
cd frontend
npm run test:fullstack
```

`playwright.fullstack.config.ts` starts the emulator, AST engine, backend and frontend,
and `e2e/fullstack.setup.ts` seeds one college, an admin, a teacher and three students
(emulator only; the seed script refuses to run against a real project). The backend's
output, including the dev verification link, goes to `fullstack-backend.log`.

**Hardware note:** the full stack needs roughly 6 GB of free memory. On a 4 GB laptop it
slows to a crawl; use the CI run instead.
