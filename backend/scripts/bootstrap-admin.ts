import * as dotenv from 'dotenv';
// Same initialisation as the server: uses config/serviceAccountKey.json when present.
import admin from '../src/db/firebase';
import { hashPassword } from '../src/modules/auth/passwordHash.util';

dotenv.config();

async function bootstrap() {
  const email = process.argv[2] || process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.argv[3] || process.env.BOOTSTRAP_ADMIN_PASSWORD;
  
  if (!email || !password) {
    console.error('Error: Please provide email and password as arguments or via env vars.');
    console.error('Usage: npx ts-node scripts/bootstrap-admin.ts <EMAIL> <PASSWORD>');
    process.exit(1);
  }

  const db = admin.firestore();
  
  try {
    console.log(`Bootstrapping admin role for user: ${email}`);
    
    const hashedPassword = await hashPassword(password);
    
    const usersRef = db.collection('users');
    const existing = await usersRef.where('email', '==', email).limit(1).get();
    
    let targetDoc;
    if (!existing.empty) {
      console.log('User already exists, updating role and password...');
      targetDoc = existing.docs[0].ref;
    } else {
      targetDoc = usersRef.doc();
    }
    
    const userData: any = {
      email,
      passwordHash: hashedPassword,
      role: 'ADMIN',
      collegeId: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (existing.empty) {
      userData.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }
    
    await targetDoc.set(userData, { merge: true });
    
    console.log(`✅ Successfully bootstrapped admin user! UID: ${targetDoc.id}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to bootstrap admin:', error);
    process.exit(1);
  }
}

bootstrap();
