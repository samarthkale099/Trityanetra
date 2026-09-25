import { COLLECTIONS } from '../config/constants';
import { getFirestore } from './firestore';

export const db = {
  users: () => getFirestore().collection(COLLECTIONS.USERS),
  colleges: () => getFirestore().collection(COLLECTIONS.COLLEGES),
  classrooms: () => getFirestore().collection(COLLECTIONS.CLASSROOMS),
  tests: () => getFirestore().collection(COLLECTIONS.TESTS),
  questions: () => getFirestore().collection(COLLECTIONS.QUESTIONS),
  submissions: () => getFirestore().collection(COLLECTIONS.SUBMISSIONS),
  monitorFlags: () => getFirestore().collection(COLLECTIONS.MONITOR_FLAGS),
  plagiarismJobs: () => getFirestore().collection(COLLECTIONS.PLAGIARISM_JOBS),
  plagiarismResults: () => getFirestore().collection(COLLECTIONS.PLAGIARISM_RESULTS),
};
