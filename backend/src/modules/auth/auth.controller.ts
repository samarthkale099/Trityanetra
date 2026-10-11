import { Request, Response, NextFunction } from 'express';
import { assignUserRoleService } from './auth.service';
import { Role } from '../../types/roles';
import { hashPassword, comparePassword } from './passwordHash.util';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { db } from '../../db/firestore';
import { COLLECTIONS } from '../../db/collections';

export const assignUserRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { targetUid, role, collegeId } = req.body;
    
    if (!targetUid || !role || !Object.values(Role).includes(role)) {
      return res.status(400).json({ error: 'Missing targetUid or invalid role' });
    }

    if (role !== Role.ADMIN && !collegeId) {
      return res.status(400).json({ error: 'collegeId is required for STUDENT and TEACHER roles' });
    }

    await assignUserRoleService(targetUid, role, collegeId || null, req.user!);

    res.status(200).json({ message: 'Role assigned successfully' });
  } catch (error) {
    next(error);
  }
};

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, role, collegeId } = req.body;

    // The college must exist: an arbitrary collegeId string must never create an account.
    const collegeDoc = await db.collection(COLLECTIONS.COLLEGES).doc(collegeId).get();
    if (!collegeDoc.exists) {
      return res.status(400).json({ error: 'Unknown collegeId' });
    }

    const usersRef = db.collection(COLLECTIONS.USERS);
    
    // Check for duplicate email
    const existingUser = await usersRef.where('email', '==', email).limit(1).get();
    if (!existingUser.empty) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await hashPassword(password);
    
    // Generate document reference with auto-generated ID
    const newUserRef = usersRef.doc();
    
    const userData = {
      email,
      passwordHash: hashedPassword,
      role,
      collegeId: collegeId || null,
      createdAt: new Date(),
    };

    await newUserRef.set(userData);

    // Return 201 without passwordHash
    res.status(201).json({
      message: 'User registered successfully',
      user: {
        uid: newUserRef.id,
        email: userData.email,
        role: userData.role,
        collegeId: userData.collegeId,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    const usersRef = db.collection(COLLECTIONS.USERS);
    const userSnapshot = await usersRef.where('email', '==', email).limit(1).get();

    if (userSnapshot.empty) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();

    // Check password
    if (!userData.passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await comparePassword(password, userData.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Issue JWT
    const payload = {
      uid: userDoc.id,
      email: userData.email,
      role: userData.role,
      collegeId: userData.collegeId,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '1d' });

    res.status(200).json({ token });
  } catch (error) {
    next(error);
  }
};

