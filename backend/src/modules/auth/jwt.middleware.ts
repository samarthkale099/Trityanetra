import { Request, Response, NextFunction } from 'express';
import { getFirebaseApp } from '../../db/firebase';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: { message: 'Missing or invalid authorization header', code: 'UNAUTHORIZED' },
      });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await getFirebaseApp().auth().verifyIdToken(token);

    // Look up user from Firestore to get role
    const { getFirestore } = await import('../../db/firestore');
    const userDoc = await getFirestore().collection('users').doc(decodedToken.uid).get();

    if (!userDoc.exists) {
      return res.status(401).json({
        error: { message: 'User not found', code: 'USER_NOT_FOUND' },
      });
    }

    const userData = userDoc.data()!;
    (req as any).user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: userData.role,
      displayName: userData.displayName,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      error: { message: 'Invalid or expired token', code: 'UNAUTHORIZED' },
    });
  }
}
