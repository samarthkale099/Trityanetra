import { Request, Response, NextFunction } from 'express';
import { assignUserRoleService } from './auth.service';
import { Role } from '../../types/roles';
import { hashPassword, comparePassword } from './passwordHash.util';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { db } from '../../db/firestore';
import { COLLECTIONS } from '../../db/collections';
import { linkInvitesForUser, normalizeEmail } from '../classroom/classroom.service';
import { findCollegeByEmail } from '../college/college.service';
import { issueVerification, verifyEmailToken, resendVerification } from './emailVerification.service';

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
    const { password, role, collegeId: requestedCollegeId, displayName } = req.body;
    const email = normalizeEmail(req.body.email);

    // Work out the college. An email on a college's emailDomain is placed there automatically;
    // otherwise a collegeId must be given, and it must not belong to a college that restricts its domain.
    const matched = await findCollegeByEmail(email);
    let resolvedCollegeId: string;
    if (matched) {
      if (requestedCollegeId && requestedCollegeId !== matched.id) {
        return res.status(400).json({ error: 'This email belongs to a different college than the collegeId given' });
      }
      resolvedCollegeId = matched.id;
    } else {
      if (!requestedCollegeId) {
        return res.status(400).json({
          error: 'No college matches this email domain. Use your college email address, or provide a collegeId.',
        });
      }
      // The college must exist: an arbitrary collegeId string must never create an account.
      const collegeDoc = await db.collection(COLLECTIONS.COLLEGES).doc(requestedCollegeId).get();
      if (!collegeDoc.exists) {
        return res.status(400).json({ error: 'Unknown collegeId' });
      }
      if (collegeDoc.data()?.emailDomain) {
        return res.status(403).json({ error: 'This college only accepts registrations from its own email domain' });
      }
      resolvedCollegeId = requestedCollegeId;
    }

    const usersRef = db.collection(COLLECTIONS.USERS);

    // Check for duplicate email (stored lower-cased; older rows may keep their original case)
    const existingUser = await usersRef.where('email', '==', email).limit(1).get();
    const existingLegacy =
      email !== req.body.email ? await usersRef.where('email', '==', req.body.email).limit(1).get() : null;
    if (!existingUser.empty || (existingLegacy && !existingLegacy.empty)) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await hashPassword(password);

    // Generate document reference with auto-generated ID
    const newUserRef = usersRef.doc();

    const userData = {
      email,
      displayName: (displayName || email.split('@')[0]).trim(),
      passwordHash: hashedPassword,
      role,
      collegeId: resolvedCollegeId,
      emailVerified: false,
      createdAt: new Date(),
    };

    await newUserRef.set(userData);

    // A teacher may have added this email before it registered: honour those invites now.
    await linkInvitesForUser(newUserRef.id, email, userData.collegeId);

    // Email the verification link. A failure here must not fail registration (the user can resend).
    try {
      await issueVerification(newUserRef.id, userData.email);
    } catch (mailErr) {
      console.error('Failed to send verification email:', (mailErr as Error).message);
    }

    // Return 201 without passwordHash
    res.status(201).json({
      message: 'Registered. Check your email for a verification link before logging in.',
      user: {
        uid: newUserRef.id,
        email: userData.email,
        displayName: userData.displayName,
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
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);

    const usersRef = db.collection(COLLECTIONS.USERS);
    let userSnapshot = await usersRef.where('email', '==', email).limit(1).get();
    if (userSnapshot.empty && email !== req.body.email) {
      // Accounts created before emails were lower-cased.
      userSnapshot = await usersRef.where('email', '==', req.body.email).limit(1).get();
    }

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

    // Accounts created with email verification must verify first. Accounts predating this feature have no
    // emailVerified field and are allowed through (grandfathered), so admin bootstrap and older users work.
    if (userData.emailVerified === false) {
      return res.status(403).json({ error: 'Please verify your email before logging in', code: 'EMAIL_NOT_VERIFIED' });
    }

    // Invites made after registration are linked on the next sign-in. Best
    // effort: a failure here must never block signing in.
    if (userData.role === Role.STUDENT) {
      try {
        await linkInvitesForUser(userDoc.id, userData.email, userData.collegeId ?? null);
      } catch (linkError) {
        console.error('Linking classroom invites failed:', linkError);
      }
    }

    // Issue JWT
    const payload = {
      uid: userDoc.id,
      email: userData.email,
      displayName: userData.displayName ?? userData.email.split('@')[0],
      role: userData.role,
      collegeId: userData.collegeId,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '1d' });

    res.status(200).json({ token });
  } catch (error) {
    next(error);
  }
};

/** The signed-in user's profile, read fresh from the users document. */
export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(req.user!.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userDoc.data()!;
    const createdAt = user.createdAt?.toDate ? user.createdAt.toDate() : user.createdAt;
    res.status(200).json({
      user: {
        uid: userDoc.id,
        email: user.email,
        displayName: user.displayName ?? user.email.split('@')[0],
        role: user.role,
        collegeId: user.collegeId ?? null,
        createdAt: createdAt ? new Date(createdAt).toISOString() : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const verifyEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = (req.method === 'GET' ? req.query.token : req.body.token);
    await verifyEmailToken(token);
    res.status(200).json({ message: 'Email verified. You can now log in.' });
  } catch (error) {
    next(error);
  }
};

export const resendVerificationEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await resendVerification(normalizeEmail(req.body.email));
    // Always generic, so the response never reveals whether an account exists.
    res.status(200).json({ message: 'If that account exists and is unverified, a new link has been sent.' });
  } catch (error) {
    next(error);
  }
};
