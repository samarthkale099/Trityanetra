/** Behaviour signals the exam client reports. Advisory only -- never auto-punishment. */
export enum MonitorFlagType {
  TAB_SWITCH = 'TAB_SWITCH',
  DEVTOOLS_OPEN = 'DEVTOOLS_OPEN',
  PASTE_ATTEMPT = 'PASTE_ATTEMPT',
  FULLSCREEN_EXIT = 'FULLSCREEN_EXIT'
}

/** One recorded flag, as a teacher reads it back. */
export interface MonitorFlagEntry {
  flagType: MonitorFlagType;
  at: string | null;
  metadata: Record<string, unknown>;
}

/** All flags for one student on one test, newest first. */
export interface StudentFlagSummary {
  studentId: string;
  studentName: string;
  studentEmail: string;
  total: number;
  counts: Partial<Record<MonitorFlagType, number>>;
  flags: MonitorFlagEntry[];
}
