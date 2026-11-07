# Putting Trityanetra online with Google

Everything is done in a web browser. Nothing needs to be installed on your laptop.

**Result:** the site at `https://<your-project>.web.app`, open to anyone on the internet;
who gets in is decided by accounts (college email domain + email verification, students
only see classrooms they were added to, teachers and admins are assigned by an admin).

| Part | Where it runs |
|---|---|
| Website | Firebase Hosting (free) |
| Backend API | Cloud Run, service `trityanetra-backend` |
| AST engine | Cloud Run, service `trityanetra-ast` |
| Database | Firestore |
| Redis (plagiarism queue, rate limits) | Redis Cloud free plan (Google's own Redis is paid) |
| Emails | Gmail with an app password |

Firebase Hosting forwards every `/api/...` request to the backend, so the site and the API
share one address.

> **Cost.** Cloud Run needs a billing account (a card) even though a college project stays
> inside the free tier. Step 1 adds a budget alert so you are warned before any charge.

---

## 1. Firebase project and billing (10 min)

1. Open <https://console.firebase.google.com>, then open your project (or **Add project**).
   Note the **project ID** (e.g. `trityanetra-7f2a1`).
2. Bottom-left **Upgrade** → **Blaze (pay as you go)** → link or create a billing account.
3. <https://console.cloud.google.com/billing> → **Budgets & alerts** → **Create budget** →
   amount ₹100 → alerts at 50 % and 100 %.

## 2. Firestore database (5 min)

1. Firebase console → **Firestore Database** → **Create database** →
   location **asia-south1 (Mumbai)** → **production mode**.
2. **Rules** tab: the website never talks to Firestore directly (only the backend does), so
   deny everything:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} { allow read, write: if false; }
     }
   }
   ```
   **Publish.**

## 3. Two secrets you generate (2 min)

Open **Cloud Shell** (the `>_` icon at the top of <https://console.cloud.google.com>) and run
this twice. Keep both values somewhere private:
```bash
openssl rand -hex 32
```
- the first is **JWT_SECRET** (signs sign-in tokens)
- the second is **AST_SECRET** (lets the backend talk to the AST engine)

## 4. Redis (5 min)

1. Sign up at <https://redis.io/try-free/> → create a **free** database (30 MB),
   cloud **Google Cloud**, region **asia-south1** if offered.
2. From the database page copy the **public endpoint**, user `default` and the password.
   Your **REDIS_URL** is `redis://default:<password>@<endpoint>` (use `rediss://` if the page
   says TLS is on).

## 5. Gmail for verification emails (5 min)

1. Use a Gmail account for the project (e.g. `trityanetra.noreply@gmail.com`).
   Turn on **2-Step Verification** for it.
2. <https://myaccount.google.com/apppasswords> → create an app password named "Trityanetra".
3. Your **SMTP_URL** is `smtps://<gmail-address>:<app-password-without-spaces>@smtp.gmail.com:465`
   (write `@` in the address as `%40`, e.g. `trityanetra.noreply%40gmail.com`).

## 6. AST engine on Cloud Run (10 min)

<https://console.cloud.google.com/run> → **Deploy container** → **Service** →
**Continuously deploy from a repository** → **Set up with Cloud Build**:

1. Connect GitHub, choose the repository, branch `^main$`.
2. Build type **Dockerfile**, source location `/ast-engine/Dockerfile`.
3. Service name **`trityanetra-ast`**, region **asia-south1**,
   **Allow unauthenticated invocations** (the engine refuses any call without the secret).
4. **Container(s) → Variables & secrets**:
   - `AST_ENGINE_INTERNAL_SECRET` = your **AST_SECRET**
   - `AST_ENGINE_HOST` = `0.0.0.0`
5. **Container → Resources**: memory **1 GiB**. **Create**.
6. When it is green, copy its **URL** (`https://trityanetra-ast-....run.app`).

## 7. Backend on Cloud Run (10 min)

Same as step 6, with:

1. Source location `/backend/Dockerfile`.
2. Service name **`trityanetra-backend`** (must be exactly this; the website forwards to it),
   region **asia-south1**, **Allow unauthenticated invocations**.
3. **Billing: Instance-based / CPU always allocated** (the plagiarism worker runs in the
   background). Minimum instances **0**, maximum **2**. Memory **512 MiB**.
4. **Variables & secrets**:

   | Name | Value |
   |---|---|
   | `JWT_SECRET` | your JWT_SECRET |
   | `REDIS_URL` | from step 4 |
   | `AST_ENGINE_URL` | the AST engine URL from step 6 |
   | `AST_ENGINE_SECRET` | your AST_SECRET |
   | `APP_BASE_URL` | `https://<project-id>.web.app` |
   | `CORS_ORIGINS` | `https://<project-id>.web.app,https://<project-id>.firebaseapp.com` |
   | `SMTP_URL` | from step 5 |
   | `MAIL_FROM` | `Trityanetra <your-gmail-address>` |
   | `CODE_EXECUTION_PROVIDER` | `paiza` |
   | `PAIZA_API_KEY` | `guest` |
   | `TRUST_PROXY` | `2` |

   The service uses its built-in Google identity for Firestore, so no key file is needed.
5. **Create.**

Both services now rebuild automatically whenever `main` changes.

## 8. Website on Firebase Hosting (10 min)

1. Firebase console → **Project settings** → **Service accounts** →
   **Generate new private key**. A JSON file downloads. **It is a master key**: do not email
   it or commit it.
2. GitHub repository → **Settings** → **Secrets and variables** → **Actions**:
   - **Secrets** → **New repository secret**: name `FIREBASE_SERVICE_ACCOUNT`, value = the
     whole JSON file's text.
   - **Variables** → **New repository variable**: name `FIREBASE_PROJECT_ID`, value = your
     project ID.
3. Delete the downloaded JSON file from your laptop.
4. GitHub → **Actions** → **Deploy website** → **Run workflow**.
   From now on every merge to `main` republishes the site.

## 9. First admin and your college (5 min)

In **Cloud Shell**:
```bash
git clone https://github.com/<owner>/Trityanetra.git && cd Trityanetra/backend
```
```bash
npm ci
```
```bash
GOOGLE_CLOUD_PROJECT=<project-id> npx ts-node scripts/bootstrap-admin.ts <your-email-in-lowercase> '<a-strong-password>'
```
If it reports missing credentials, run `gcloud auth application-default login` once and repeat.

Then open `https://<project-id>.web.app`, sign in with that email, open **Colleges** →
**Add college** (name, code, email domain such as `mitwpu.edu.in`), then **People** to make
teachers once they have registered.

## 10. Check it works

- Register a student with a college email → the verification email arrives → sign in.
- Teacher: create a classroom, add the student, create a test → the student sits it →
  run the plagiarism check.
- Do one trial exam with 3–5 friends before a real class.

## Good to know

- **Cold start:** with minimum instances 0, the first visit after a quiet period takes a few
  seconds while Cloud Run starts. Before an exam, open the site once.
- **Limits that protect the public site:** 10 sign-in attempts per 15 minutes per account,
  10 sign-ups per hour per network, 3 verification emails per 15 minutes, 10 code runs per
  minute per student.
- **Logs:** Cloud Run → service → **Logs**.
- **Your own domain:** Firebase console → **Hosting** → **Add custom domain**.
