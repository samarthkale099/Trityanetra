import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  getIdToken,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import { getFirebaseApp } from '@/shared/lib/firebase'
import type { AuthDriver, AuthUser } from '@/shared/lib/authTypes'

export type { AuthDriver, AuthUser, SignUpInput } from '@/shared/lib/authTypes'

function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? user.email?.split('@')[0] ?? 'Student',
  }
}

export const firebaseAuthDriver: AuthDriver = {
  initialize: async () => {
    // Persistent login: the session survives a tab close or a browser restart.
    // Without this, Firebase defaults to in-memory storage and a refresh signs
    // the user out silently.
    await setPersistence(getAuth(getFirebaseApp()), browserLocalPersistence)
  },

  subscribe: (listener) => onAuthStateChanged(getAuth(getFirebaseApp()), (user) => listener(user ? toAuthUser(user) : null)),

  signUp: async ({ email, password, displayName }) => {
    const credential = await createUserWithEmailAndPassword(getAuth(getFirebaseApp()), email, password)
    try {
      await updateProfile(credential.user, { displayName })
    } catch {
      throw new Error('Account created, but your display name could not be saved. Sign in and update it later.')
    }
  },

  signIn: async (email, password) => {
    await signInWithEmailAndPassword(getAuth(getFirebaseApp()), email, password)
  },

  signOut: async () => {
    await firebaseSignOut(getAuth(getFirebaseApp()))
  },

  sendPasswordReset: async (email) => {
    await sendPasswordResetEmail(getAuth(getFirebaseApp()), email)
  },

  getIdToken: async (forceRefresh = false) => {
    const user = getAuth(getFirebaseApp()).currentUser
    if (!user) return null
    return getIdToken(user, forceRefresh)
  },
}
