import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'

const FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

function readEnv(key: (typeof FIREBASE_ENV_KEYS)[number]): string {
  const value = import.meta.env[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** True once the Vite env exposes a complete Firebase web config. */
export function isFirebaseConfigured(): boolean {
  return FIREBASE_ENV_KEYS.every((key) => readEnv(key).length > 0)
}

export function getFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) {
    return getApp()
  }
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Firebase is not configured. Add the VITE_FIREBASE_* values to frontend/.env.local — see frontend/.env.example.',
    )
  }
  return initializeApp({
    apiKey: readEnv('VITE_FIREBASE_API_KEY'),
    authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: readEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: readEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: readEnv('VITE_FIREBASE_APP_ID'),
  })
}