# Trityanetra v2

Secure, role-based online examination platform: colleges, classrooms, timed tests, drafts and one-shot submissions, code execution (Judge0), tab/behaviour monitoring, and AST-based plagiarism detection.

## Architecture
- **Backend** (`/backend`): Node.js / Express / TypeScript. Data in **Firebase Firestore** via `firebase-admin`. Auth is **custom JWT** (bcrypt password hashes, 1-day tokens carrying `uid`, `role`, `collegeId`). All authorization derives from the verified token, never from request bodies.
- **Frontend** (`/frontend`): Next.js 14 (Pages Router) + Tailwind. Calls relative `/api/...` URLs, which `next.config.js` proxies to the backend (default `http://127.0.0.1:5001`, override with `BACKEND_URL`). Pages: `/login`, `/register` (students only), student / teacher / college pages.
- **Code execution:** pluggable via `CODE_EXECUTION_PROVIDER` — **Paiza** (free, built-in `guest` key, currently in use), Piston, or Judge0.
- **AST engine** (`/ast-engine`): Python service that scores code similarity between submissions. Called by the backend plagiarism worker with the `X-Internal-Secret` header; max 50 submissions per check.
- **Redis**: used only for the plagiarism job queue (BullMQ) and rate-limit counters (`rl:monitor:`, `rl:judge0:` namespaces). Data stays in Firestore. Start locally with `docker compose up -d redis`.

## Setup
Prerequisites: Node 18+, Docker (for Redis / AST engine), a Firebase project.

Backend:
1. `cd backend && npm install`
2. Copy `.env.example` to `.env` and fill in values (never commit `.env` or `config/serviceAccountKey.json`).
3. `npm run dev`

Frontend: `cd frontend && npm install && npm run dev`

Tests (needs Java for the Firebase emulator): `cd backend && npm test`
This runs Vitest inside the Firestore/Auth emulators (`demo-test` project); no real data is touched.

## Roles
- **STUDENT**: self-registers (requires an existing `collegeId`), enters tests in their window, saves drafts, submits once.
- **TEACHER**: assigned by an admin. Manages classrooms and tests in their college, runs plagiarism checks.
- **ADMIN**: college admins are scoped to their college; root admin (`collegeId` null) is global and the only one who can grant ADMIN.

Promoted users must log in again to get a token with the new role.

## Key invariants
1. One submission per test+student (`testId_userId`, Firestore transaction).
2. Submitted/finalized exams are locked; draft saves and submits are transactional, so a save cannot overwrite a submit.
3. Test windows are checked with server time.
4. Cross-college access is denied except for the root admin.
5. Monitor flags are append-only, restricted to enrolled students, rate limited (1 per 2s per user+test).
6. Firestore rules are deny-all; only the backend (Admin SDK) touches data.

## Layout
```text
backend/src/
  config/ lib/ middleware/ types/
  modules/ auth, classroom, college, submission, test, monitor, judge0, plagiarism
  tests/   unit/integration tests + tests/security (Phase 4)
frontend/pages/  login, register, college/, student/, teacher/
ast-engine/      Python plagiarism engine
redis/ docker-compose.yml
```

## Known gaps
- Email verification: new signups must verify their email before login (link valid 24h). Set `SMTP_URL` to send real mail; otherwise the link is printed to the backend console (dev). Accounts predating this feature are grandfathered in.
- Code execution: callbacks (Judge0 async mode) are authenticated by a secret in the URL (`/api/judge0/callback/<JUDGE0_CALLBACK_TOKEN>`), with replay/state checks against `judge0Runs`. Students run code via `POST /api/judge0/tests/:testId/run` (member of the test's classroom, inside the window, rate limited); the run record is created before the engine is called (for Judge0's async mode its id rides in the callback URL). Three interchangeable providers, chosen by `CODE_EXECUTION_PROVIDER`: **Paiza** (free, built-in `guest` key, no signup — the one currently in use and verified working), **Piston** (free public API, but its execute endpoint is often blocked), or **Judge0** (self-hosted, or RapidAPI with the key header auto-detected — RapidAPI has no free tier). Paiza and Piston run the code and return the result inline; Judge0 does the same on localhost, and additionally supports an async callback mode when the backend is publicly reachable (`JUDGE0_CALLBACK_BASE_URL` + `JUDGE0_CALLBACK_TOKEN`, authenticated by the secret in the callback URL with replay/state checks against `judge0Runs`). Each run records which provider ran it. Verify live: `scripts/paiza-smoke.ts` (free, works), `scripts/piston-smoke.ts`, or `scripts/judge0-smoke.ts`.
- `answers` shape for coding questions: a submission's `answers` holds `{ code: string, language: string }` (dictated by the AST engine's SubmissionInput; `language` defaults to `python`, which is the only one AST-parsed). Schema: `modules/submission/submission.schema.ts`. Open for the team: whether one test can hold several coding questions (would require keying code by question id).
- First admin/college bootstrap is manual (`scripts/bootstrap-admin.ts`, then `POST /api/colleges`).
- Maximum class size for plagiarism checks: `MAX_PLAGIARISM_BATCH_SIZE` (default 50) — must equal the AST engine's `MAX_BATCH_SIZE`. The AST owner sets the real number in the engine; change the env var to match, no code change.
- Redis: rate limiters and the plagiarism queue are verified against a real Redis via `scripts/redis-smoke.ts`.
