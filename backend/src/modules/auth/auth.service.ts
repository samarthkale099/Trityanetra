import { getFirestore } from '../../db/firestore';
import { getFirebaseApp } from '../../db/firebase';
import { ROLES, UserRole } from '../../config/constants';

interface CreateUserInput {
  email: string;
  password: string;
  displayName: string;
  role?: UserRole;
  collegeId?: string;
}

interface AuthResult {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  token: string;
}

export class AuthService {
  private firestore = getFirestore();
  private auth = getFirebaseApp().auth();

  async register(input: CreateUserInput): Promise<AuthResult> {
    // Create Firebase Auth user
    const userRecord = await this.auth.createUser({
      email: input.email,
      password: input.password,
      displayName: input.displayName,
    });

    // Create Firestore user document
    const role = input.role || ROLES.STUDENT;
    await this.firestore.collection('users').doc(userRecord.uid).set({
      email: input.email,
      displayName: input.displayName,
      role,
      collegeId: input.collegeId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Generate custom token (for client use)
    const token = await this.auth.createCustomToken(userRecord.uid);

    return {
      uid: userRecord.uid,
      email: input.email,
      displayName: input.displayName,
      role: role as UserRole,
      token,
    };
  }

  async getUserByUid(uid: string) {
    const doc = await this.firestore.collection('users').doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }
}

export const authService = new AuthService();
