export const CLASSROOM_ACTIONS = {
  ADD: 'add',
  REMOVE: 'remove',
} as const;

export type ClassroomAction = typeof CLASSROOM_ACTIONS[keyof typeof CLASSROOM_ACTIONS];
