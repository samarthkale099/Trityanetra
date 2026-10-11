# Trityanetra v2

## 1. PROJECT OVERVIEW
Trityanetra is a secure, role-based examination platform designed to manage colleges, classrooms, tests, and student submissions. 
This repository contains the **Phase 2** implementation, focusing on core backend architecture, secure exam delivery, submission idempotency, and foundational UI.

**Explicitly Out of Scope for Phase 2 (Planned for Phase 3):**
- Judge0 integration (code execution)
- AST plagiarism detection
- Plagiarism queue

## 2. ARCHITECTURE
- **Backend:** Node.js / Express with TypeScript.
- **Frontend:** Next.js (Pages Router) + React + TailwindCSS.
- **Database:** Firebase Firestore (managed via `firebase-admin` on the backend).
- **Authentication:** Firebase Auth. Client-supplied IDs (`req.body.studentId`, etc.) are explicitly distrusted. All authorization derives from the server-verified JWT (`req.user.uid` and `req.user.role`).

## 3. SETUP

**Prerequisites:** Node.js v18+, Firebase project.

**Backend Setup:**
1. Navigate to `/backend`
2. `npm install`
3. Set your Firebase Admin credentials in your environment.
4. `npm run dev` (Ensure a suitable TypeScript runner like `ts-node` or `nodemon` is configured in `package.json`).

**Frontend Setup:**
1. Navigate to `/frontend`
2. `npm install`
3. `npm run dev`

## 4. ROLES & ACCESS
- **STUDENT:** Can view their enrolled classrooms, enter tests (only during the strict test window), save answer drafts, and submit exams exactly once.
- **TEACHER:** Can create classrooms, manage students in their classrooms, create tests, and monitor submissions for their tests.
- **ADMIN:** Has global access. Can create colleges, classrooms, tests, and assign teachers. 

*Note: Cross-college boundaries are strictly enforced. A user bound to `collegeId` 'A' cannot read or write data for `collegeId` 'B', unless they are a root admin (`collegeId` is null).*

## 5. KEY INVARIANTS
The system enforces strict data integrity rules that future contributors **must not break**:

1. **One Submission Per Test+Student:** Enforced via a server-side Firestore transaction inside `submitExam`. The system uses a deterministic composite ID (`testId_userId`). If a submission request is retried (e.g. network hiccup), the transaction safely catches the `ALREADY_SUBMITTED` state.
2. **Immutability of Submitted Exams:** A submitted exam cannot be modified. `submissionLock.guard.ts` verifies the submission status directly in Firestore before allowing any write operation (draft or final).
3. **Server-side Test Windows:** The test window (start/active/end) is validated strictly using backend server time in `testWindow.guard.ts`. Frontend timers are entirely cosmetic and cannot bypass the window.

## 6. PROJECT STRUCTURE
```text
/backend
  /src
    /config           # Firebase admin initialization
    /middleware       # auth.middleware.ts, rbac.middleware.ts
    /modules
      /auth           # Role assignment and custom claims
      /classroom      # Classroom CRUD & membership
      /college        # College CRUD & boundaries
      /submission     # Drafts, final submit (transactions), lock guards
      /test           # Test CRUD, window guards, membership guards
    /types            # Roles and Auth identity definitions

/frontend
  /pages
    /college          # Admin dashboards
    /student          # StudentDashboard, TestLobby, ExamPage
    /teacher          # ClassroomList, ClassroomDetail, TestCreate
```

## 7. KNOWN GAPS / TODO
While the Phase 2 requirements have been structurally fulfilled, the following remain as missing pieces or stubs because they rely on components outside the current scope:

- **ID Token Refreshing:** After a user's role is updated on the server (via claims), the client MUST force-refresh its ID token (e.g., `await auth.currentUser.getIdToken(true)`) before the new role claim becomes usable for Firestore rules or backend requests. If a user sets a role but says "it's still not working," they likely haven't refreshed their token.
- **Firestore DB initialization:** `firebase.ts` runs `admin.initializeApp()` without explicit service accounts because the local env is not set up.
- **Frontend Auth State:** Frontend pages fetch data using a `localStorage.getItem('token')` mock strategy, rather than a real Firebase Auth context provider.
- **Test Questions Structure:** Questions are stored generically as an array in Firestore without a strictly typed schema.
