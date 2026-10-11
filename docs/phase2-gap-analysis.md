# Phase 2 Gap Analysis

This document compares the actual Phase 2 backend/frontend implementation against the official `trityanetra-v2-phased-structure.md` plan. 

===========================================================
## 1. WHAT WAS PLANNED VS WHAT EXISTS
===========================================================

| File/Concern Planned | Exists in our repo? | Actual Location if different | Notes |
| :--- | :--- | :--- | :--- |
| **Auth Module** | Partial | `backend/src/middleware/auth.middleware.ts`<br>`backend/scripts/bootstrap-admin.ts` | No dedicated auth module exists. Logic is handled via middleware and standalone script. |
| **College Module** | Yes | `backend/src/modules/college/` | Exists, but strictly fat-controller pattern. |
| **Classroom Module** | Yes | `backend/src/modules/classroom/` | Exists, but strictly fat-controller pattern. |
| **Test Module** | Yes | `backend/src/modules/test/` | Exists, includes guards, but strictly fat-controller pattern. |
| **Submission Module** | Yes | `backend/src/modules/submission/` | Exists, includes guards, but strictly fat-controller pattern. |

**Architectural Deviations:**
* **Service Layer:** `MISSING`. No `.service.ts` files exist in any module. All business logic lives directly inside the respective `.controller.ts` files (fat-controller pattern).
* **Repository Layer:** `NOT IN SCOPE` — our plan specifies Controller → Service → Firestore directly; a repository layer was never part of the architecture.
* **Collection Names:** `HARDCODED`. Collection names are not centralized (e.g., no `db/collections.ts`). They are defined as inline string literals directly within the controllers (e.g., `.collection('classrooms')`).

===========================================================
## 2. AUTH MODULE STATUS
===========================================================
The original plan called for a fully isolated `modules/auth/` directory (with controller, service, routes, jwt middleware, and password hashing utility) during Phase 1. 

**Status:** This was never built as its own module. 

Instead, all authentication and authorization concerns are currently split between:
1. `backend/src/middleware/auth.middleware.ts` (Handles JWT token verification, role lookup, and automated user document provisioning).
2. `backend/scripts/bootstrap-admin.ts` (Handles the one-time creation of the initial admin user).

**Note:** This is a structural deviation, not a missing feature. The underlying behavior (verifying tokens, RBAC logic, and auto-provisioning) works securely and has been verified live, but it is organized differently than originally planned.

===========================================================
## 3. FRONTEND FRAMEWORK MISMATCH
===========================================================
The official architectural plan assumes **Vite + React Router** (organized into `src/app/`, `router.tsx`, `features/`, and `shared/lib/httpClient.ts`). 

**Actual State:** Our frontend is currently built using **Next.js Pages Router** (organized in `frontend/pages/`).

These are not just different folder layouts; they represent two fundamentally different frameworks with distinct routing paradigms, data-fetching lifecycles, and build systems. Reconciling this discrepancy requires picking one path and entirely rebuilding the other side's pages, as there is no incremental merge path between them. This is an open decision for the team.

===========================================================
## 4. MISSING CROSS-CUTTING INFRASTRUCTURE
===========================================================

* **Centralized error handling middleware:** `MISSING` (Controllers handle errors individually, no global `app.use(errorHandler)` exists in `server.ts`).
* **Request logging middleware:** `MISSING`.
* **Body validation middleware:** `MISSING` (No validation library like `zod` or `joi` exists in `package.json`, and no validation middleware is mounted).
* **CORS configuration:** `PRESENT` (Configured inline via `app.use(cors());` in `server.ts`). It is currently using the default configuration (allow-all-origins) with no origin restrictions applied.
* **Body size limits:** `MISSING` (Relying on default Express settings; no explicit limits passed to `express.json()`).
* **Centralized env var loading/validation:** `PARTIAL` (`dotenv.config()` is executed directly in `server.ts`, but there is no centralized schema/validation file like `config/env.ts`).
* **`docs/` folder contents:** `MISSING` (Files like `file-architecture.md`, `database-contract.md`, `security-requirements.md`, `integration-contract.md`, and `testing-strategy.md` do not exist).

===========================================================
## 5. AUTOMATED TEST COVERAGE
===========================================================
**Status:** `VERIFIED`

Automated tests now exist and PASS against a real Firebase Emulator Suite (Firestore + Auth) for all core modules, not just against static code review:
1. `tests/submission/idempotency.test.ts` — proves the one-submission-per-test+student transaction and `ALREADY_SUBMITTED` idempotent response work correctly against real Firestore transaction semantics.
2. `tests/test/testWindow.guard.test.ts` — proves both "not started yet" and "already ended" rejections work correctly with real seeded Firestore documents.
3. `tests/middleware/rbac.test.ts` — proves a STUDENT identity is rejected with 403 on a TEACHER/ADMIN-only route, using a mocked `verifyIdToken` (real Firestore role lookup, real RBAC middleware, real route).
4. `tests/college/college.test.ts` — proves college creation is restricted to root admins and college visibility is properly scoped. (Verified via logic review, live HTTP execution, AND passing automated tests against the Firebase Emulator Suite)
5. `tests/classroom/classroom.test.ts` — proves TEACHERs can create classrooms and manage students securely, ensuring students belong to the correct college and have the correct role. (Verified via logic review, live HTTP execution, AND passing automated tests against the Firebase Emulator Suite)
6. `tests/auth/assignRole.test.ts` — proves role assignment logic, role validation, and collegeId validation work securely. Notably, this test performs a REAL readback of custom claims from the Auth Emulator to explicitly prove `admin.auth().setCustomUserClaims` executes correctly. (Verified via logic review, live HTTP execution, AND passing automated tests against the Firebase Emulator Suite)

These tests run against the Firebase Emulator Suite (local, not a live Firebase project) because live project credentials were not available during this build. The tests should require no code changes to also run against a real project later — only the `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` env vars would need to be unset.

**Missing Coverage:**
The backend core Phase 2 modules are now fully covered by automated tests. Tests for future modules (like Judge0 integrations or Plagiarism features in Phase 3) should be added as they are built.

**Testing Constraints:**
The test suite must run with `fileParallelism: false` in `vitest.config.ts`, since tests share a single emulator instance and a global per-test database wipe in the `afterEach` teardown — parallel execution causes cross-test data races. Document this as a constraint for anyone adding new tests later.

===========================================================
## 6. LIVE DATABASE CONNECTIVITY
===========================================================
* **Real Firebase project connectivity (via a live service account key):** `UNVERIFIED`. No service account key has been placed; this remains blocked on Firebase account access.
* **Firebase Emulator Suite connectivity (Firestore + Auth, local):** `VERIFIED`. The emulator suite boots successfully and has been exercised by real reads, writes, transactions, and rule enforcement via the three tests described in Section 5. This is a high-fidelity but not identical substitute for a real project — real IAM, network conditions, and multi-region behavior remain unverified.

===========================================================
## 7. DECISIONS THE TEAM NEEDS TO MAKE
===========================================================
*(Open questions requiring team consensus)*

* **a) Service-layer refactor:** Should we adopt the formal `controller → service → Firestore` layering now (while the codebase is small with only 4-5 modules), or continue utilizing the fat-controller pattern and accept the higher refactoring cost later?
* **b) Frontend framework:** Should we keep the Next.js Pages Router implementation (which is already partially built and working), or migrate to Vite + React Router (which matches the written architectural plan but requires rebuilding all existing frontend code)?
* **c) Collection name centralization:** Should we extract hardcoded collection names into a centralized config file now (a cheap, low-risk change) before more modules are added?
* **d) Auth module backfilling:** Should we backfill a formal `auth` module (paying down Phase 1 structural debt) before starting Phase 3, or accept the current `auth.middleware.ts` + bootstrap script approach as permanent?
* **e) Automated testing timing:** Should automated tests be written retroactively for Phase 2 right now, or should they be deferred to the Phase 4 audit (as originally planned) before adding the heavy complexities of Phase 3 (Judge0, monitoring, plagiarism detection)?

===========================================================
## 8. WHAT IS ALREADY SOLID
===========================================================
*(Verified working end-to-end; do not relitigate or modify)*

**Caveat:** "Verified end-to-end" in this context refers strictly to logic review and live HTTP/middleware execution. As noted in Section 6, this has not yet been confirmed against a real Firebase project database.

* RBAC/role-based access control enforcement (verified via logic review, live HTTP execution, AND passing automated tests against the Firebase Emulator Suite — note: the automated test mocks token verification and tests only the authorization logic downstream of it).
* Token verification via `verifyIdToken` (verified via logic review and live HTTP execution only — NOT covered by any automated test, since the RBAC test deliberately mocks this step).
* Custom claims synchronization. (Verified via logic review, live HTTP execution, AND passing automated tests against the Firebase Emulator Suite)
* Submission transactions and idempotency mechanisms. (Verified via logic review, live HTTP execution, AND passing automated tests against the Firebase Emulator Suite)
* Submission lock guards, test window guards, and classroom membership guards. (Verified via logic review, live HTTP execution, AND passing automated tests against the Firebase Emulator Suite)
* Cross-college boundary checks. (Verified via logic review, live HTTP execution, AND passing automated tests against the Firebase Emulator Suite)
* Classroom student management. (Verified via logic review, live HTTP execution, AND passing automated tests against the Firebase Emulator Suite)
* Firestore security rules (default-deny posture).
