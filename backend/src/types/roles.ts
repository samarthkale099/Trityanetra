export enum Role {
  STUDENT = 'STUDENT',
  TEACHER = 'TEACHER',
  ADMIN = 'ADMIN'
}

export interface UserIdentity {
  uid: string;
  email: string;
  role: Role;
  collegeId?: string; // May be null for root admins
  /** Display name carried in the JWT (absent on tokens issued before it was added). */
  displayName?: string;
}
