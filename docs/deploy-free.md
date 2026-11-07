# Putting Trityanetra online for free (no card)

About 1 hour, all in a web browser. Nothing to install.

| Part | Free service | Address you get |
|---|---|---|
| Website | Firebase Hosting (Spark plan) | `https://<project-id>.web.app` |
| Database | Firestore (Spark plan) | — |
| Backend + AST engine | Render free plan (`render.yaml` creates both) | `https://trityanetra-api.onrender.com` |
| Redis | Redis Cloud free plan | — |
| Emails | Gmail app password | — |

**Before an exam:** Render's free services sleep after 15 minutes without visitors; the
first visit then takes about 50 seconds. Open the site 5 minutes before the exam.
**Daily limits:** Firestore's free plan allows about 50,000 reads and 20,000 writes per day,
enough for a class of 50 doing a full lab.

Merge pull requests #3 (testing) and #4 (hosting) into `main` first.

---

## 1. Firebase: database and key (10 min)

1. <https://console.firebase.google.com> → open your project (or **Add project**; Google
   Analytics not needed). Note the **project ID**. Stay on the free **Spark** plan.
2. **Build → Firestore Database → Create database** → location **asia-south1** →
   **production mode**. On the **Rules** tab paste and **Publish**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} { allow read, write: if false; }
     }
   }
   ```
3. **Build → Hosting → Get started** → click through (no need to run the commands shown).
4. **Project settings (gear) → Service accounts → Generate new private key**. A JSON file
   downloads. It is a master key: never email it or commit it. You paste it in steps 4 and 5,
   then delete the file.

## 2. Redis (5 min)

<https://redis.io/try-free/> → sign up → create a **free** database (30 MB). From its page
copy the public endpoint and password. Your **REDIS_URL** is
`redis://default:<password>@<endpoint>`.

## 3. Gmail for verification emails (5 min)

Use a Gmail account for the project, turn on **2-Step Verification**, then create an app
password at <https://myaccount.google.com/apppasswords>. Your **SMTP_URL** is
`smtps://<gmail-address-with-@-written-as-%40>:<app-password-no-spaces>@smtp.gmail.com:465`.

## 4. Backend and AST engine on Render (15 min)

1. <https://dashboard.render.com> → sign up **with GitHub** → allow access to the
   Trityanetra repository.
2. **New → Blueprint** → pick the repository → branch `main`. Render reads `render.yaml`
   and shows two services. The secrets for sign-in and for the AST engine are generated for
   you. Fill in:

   | Name | Value |
   |---|---|
   | `AST_ENGINE_URL` | `https://trityanetra-ast.onrender.com` |
   | `REDIS_URL` | from step 2 |
   | `FIREBASE_SERVICE_ACCOUNT` | the whole JSON file's text from step 1.4 |
   | `APP_BASE_URL` | `https://<project-id>.web.app` |
   | `CORS_ORIGINS` | `https://<project-id>.web.app,https://<project-id>.firebaseapp.com` |
   | `SMTP_URL` | from step 3 |
   | `MAIL_FROM` | `Trityanetra <your-gmail-address>` |

3. **Apply.** The first build takes about 10 minutes. When both are **Live**, open
   `https://trityanetra-api.onrender.com/api/health` → it shows `{"status":"ok"}`.
   (If Render gave the AST service a different address, put that address in the backend's
   `AST_ENGINE_URL` under **Environment**.)

## 5. Website on Firebase Hosting (10 min)

GitHub repository → **Settings → Secrets and variables → Actions**:

- **Secrets → New repository secret**: `FIREBASE_SERVICE_ACCOUNT` = the same JSON text.
- **Variables → New repository variable**: `FIREBASE_PROJECT_ID` = your project ID.
- **Variables → New repository variable**: `API_BASE_URL` = `https://trityanetra-api.onrender.com`

Delete the JSON file from your laptop. Then **Actions → Deploy website → Run workflow**.
After about 3 minutes the site is at `https://<project-id>.web.app`. Every merge to `main`
republishes it.

## 6. First admin and your college (5 min)

Render's free plan has no shell, so run this once on any computer with Node (your laptop is
fine), in the repository's `backend` folder, with the key from step 1.4 saved as
`backend/config/serviceAccountKey.json` (that path is git-ignored; delete the file afterwards):
```bash
npm ci
```
```bash
npx ts-node scripts/bootstrap-admin.ts <your-email-in-lowercase> "<a-strong-password>"
```
Then sign in at `https://<project-id>.web.app` → **Colleges → Add college** (name, code,
email domain such as `mitwpu.edu.in`) → once teachers register, **People → Change role**.

## 7. Check

Register a student with a college email → the email arrives → sign in. Teacher: classroom,
add the student, create a test. Student: sit it. Teacher: plagiarism check, grade, release.
Then one trial exam with 3–5 friends.

## Later: moving to Google Cloud

When the college uses it for real and needs no sleeping and higher limits, follow
`docs/deploy-google.md` (Cloud Run; needs a billing account). Add this rewrite to
`frontend/firebase.json` first, before the `**` rule:
`{ "source": "/api/**", "run": { "serviceId": "trityanetra-backend", "region": "asia-south1" } }`.
