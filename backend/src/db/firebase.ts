import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

if (!admin.apps.length) {
  const serviceAccountPath = path.join(__dirname, '../../config/serviceAccountKey.json');
  
  // Never load real credentials under tests or when pointed at the emulator.
  const usingEmulator = process.env.NODE_ENV === 'test' || !!process.env.FIRESTORE_EMULATOR_HOST;

  if (!usingEmulator && fs.existsSync(serviceAccountPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(require(serviceAccountPath))
    });
  } else {
    admin.initializeApp();
  }
}

export default admin;
