import { getFirebaseApp } from './firebase';

export function getFirestore() {
  return getFirebaseApp().firestore();
}
