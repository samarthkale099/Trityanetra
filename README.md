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

## Configuration notes (implemented features)
- **Email verification** — new signups must verify their email before login (link valid 24h). Set `SMTP_URL` to send real mail; otherwise the link is printed to the backend console (dev). Accounts predating this feature are grandfathered in.
- **Code execution** — students run code via `POST /api/judge0/tests/:testId/run` (must be in the test's classroom, inside the window, rate limited); results at `GET /api/judge0/runs/:runId`, and each run records which engine ran it. Three interchangeable providers via `CODE_EXECUTION_PROVIDER`: **Paiza** (free, built-in `guest` key, in use and verified working), **Piston** (free public API, execute endpoint often blocked), or **Judge0** (self-hosted, or RapidAPI with the key header auto-detected — RapidAPI has no free tier). Paiza/Piston return the result inline; Judge0 also supports an async callback mode when the backend is publicly reachable (`JUDGE0_CALLBACK_BASE_URL` + `JUDGE0_CALLBACK_TOKEN`, callback authenticated by the secret in the URL with replay/state checks against `judge0Runs`). Verify live: `scripts/paiza-smoke.ts`, `scripts/piston-smoke.ts`, or `scripts/judge0-smoke.ts`.
- **Coding-answer shape** — a submission's `answers` holds `{ code: string, language: string }` (language defaults to `python`, the only one the AST engine parses). Schema and contract: `modules/submission/submission.schema.ts`.
- **Plagiarism batch size** — `MAX_PLAGIARISM_BATCH_SIZE` (default 50) caps submissions per check; set it to equal the AST engine's `MAX_BATCH_SIZE`. No code change needed.
- **First admin/college bootstrap** — intentionally manual: run `scripts/bootstrap-admin.ts`, then `POST /api/colleges`.
- **Redis** — rate limiters and the plagiarism queue are verified against a real Redis via `scripts/redis-smoke.ts`.

## Open items (team decisions, not code)
- **Multiple coding questions per test?** If one test can hold several coding questions, `answers` must key code by question id and the plagiarism worker must pick one per check. Needs a frontend/team decision.
- **Engine `MAX_BATCH_SIZE`** — the AST owner sets the real maximum class size in the engine; then set `MAX_PLAGIARISM_BATCH_SIZE` to match.
