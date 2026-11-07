import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

if (!admin.apps.length) {
  const serviceAccountPath = path.join(__dirname, '../../config/serviceAccountKey.json');
  
  // Never load real credentials under tests or when pointed at the emulator.
  const usingEmulator = process.env.NODE_ENV === 'test' || !!process.env.FIRESTORE_EMULATOR_HOST;

  // On hosts without a key file (e.g. Render), the key's JSON can come from
  // FIREBASE_SERVICE_ACCOUNT, as plain JSON or base64. Google Cloud needs neither.
  const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!usingEmulator && fromEnv) {
    const json = fromEnv.startsWith('{') ? fromEnv : Buffer.from(fromEnv, 'base64').toString('utf8');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) });
  } else if (!usingEmulator && fs.existsSync(serviceAccountPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(require(serviceAccountPath))
    });
  } else {
    admin.initializeApp();
  }
}

export default admin;
