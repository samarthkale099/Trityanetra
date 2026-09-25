import { MonitorService, CreateFlagInput } from './monitor.service';
import { MONITOR_FLAG_TYPES } from '../../config/constants';

// Mock Firestore — each .doc() call returns a fresh id + set spy so tests can
// prove append-only behavior (every createFlag writes a NEW document).
const mockSets: jest.Mock[] = [];
let docCounter = 122;

const mockCollection = {
  doc: jest.fn().mockImplementation(() => {
    docCounter += 1;
    const set = jest.fn().mockResolvedValue(undefined);
    mockSets.push(set);
    return { id: `flag-${docCounter}`, set };
  }),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue({ docs: [] }),
};

jest.mock('../../db/firestore', () => ({
  getFirestore: () => ({
    collection: jest.fn().mockReturnValue(mockCollection),
  }),
}));

const baseInput = (): CreateFlagInput => ({
  submissionId: 'sub-123',
  studentId: 'student-123',
  testId: 'test-123',
  type: 'TAB_SWITCH',
  detail: 'Tab switched',
});

describe('MonitorService', () => {
  let service: MonitorService;

  beforeEach(() => {
    service = new MonitorService();
    jest.clearAllMocks();
    mockSets.length = 0;
    docCounter = 122;
  });

  describe('createFlag', () => {
    it('should create a flag with correct structure', async () => {
      const input: CreateFlagInput = {
        submissionId: 'sub-123',
        studentId: 'student-123',
        testId: 'test-123',
        type: 'TAB_SWITCH',
        detail: 'Tab switched at 12:05',
      };

      const flag = await service.createFlag(input);

      expect(flag.id).toBe('flag-123');
      expect(flag.submissionId).toBe('sub-123');
      expect(flag.studentId).toBe('student-123');
      expect(flag.testId).toBe('test-123');
      expect(flag.type).toBe('TAB_SWITCH');
      expect(flag.detail).toBe('Tab switched at 12:05');
      expect(flag.createdAt).toBeDefined();
    });

    it('Rule 4: stored flag contains EXACTLY the advisory fields — nothing more', async () => {
      const flag = await service.createFlag(baseInput());

      expect(Object.keys(flag).sort()).toEqual([
        'createdAt',
        'detail',
        'id',
        'studentId',
        'submissionId',
        'testId',
        'type',
      ]);
    });

    it('should store the flag in Firestore', async () => {
      const input: CreateFlagInput = {
        submissionId: 'sub-123',
        studentId: 'student-123',
        testId: 'test-123',
        type: 'PASTE_ATTEMPT',
        detail: 'Paste detected',
      };

      await service.createFlag(input);

      expect(mockSets).toHaveLength(1);
      expect(mockSets[0]).toHaveBeenCalledTimes(1);
      const storedFlag = mockSets[0].mock.calls[0][0];
      expect(storedFlag.type).toBe('PASTE_ATTEMPT');
    });

    it('should handle all flag types', async () => {
      for (const type of Object.values(MONITOR_FLAG_TYPES)) {
        const input: CreateFlagInput = {
          submissionId: 'sub-123',
          studentId: 'student-123',
          testId: 'test-123',
          type: type as any,
          detail: `Detail for ${type}`,
        };

        const flag = await service.createFlag(input);
        expect(flag.type).toBe(type);
      }

      expect(mockSets).toHaveLength(4);
      for (const set of mockSets) {
        expect(set).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('getFlagsBySubmission', () => {
    it('should return flags for a submission', async () => {
      const mockFlags = [
        { id: '1', submissionId: 'sub-123', type: 'TAB_SWITCH' },
        { id: '2', submissionId: 'sub-123', type: 'PASTE_ATTEMPT' },
      ];

      mockCollection.get.mockResolvedValueOnce({
        docs: mockFlags.map((f) => ({ data: () => f })),
      });

      const flags = await service.getFlagsBySubmission('sub-123');

      expect(flags).toHaveLength(2);
      expect(flags[0].type).toBe('TAB_SWITCH');
    });
  });

  describe('Rule 4: advisory-only guarantee', () => {
    it('should not modify submission status when creating a flag', async () => {
      const flag = await service.createFlag(baseInput());

      // Flag should only contain advisory data — no status changes
      expect(flag).not.toHaveProperty('submissionStatus');
      expect(flag).not.toHaveProperty('autoFail');
      expect(flag).not.toHaveProperty('autoTerminate');
      expect(flag).not.toHaveProperty('flaggedAsPlagiarism');
      expect(flag).not.toHaveProperty('status');
      expect(flag).not.toHaveProperty('verdict');
    });
  });

  describe('Rule 2: append-only guarantee at the service layer', () => {
    it('every createFlag call writes a NEW document (unique ids, no overwrite)', async () => {
      const first = await service.createFlag(baseInput());
      const second = await service.createFlag({ ...baseInput(), type: 'PASTE_ATTEMPT' });
      const third = await service.createFlag({ ...baseInput(), type: 'DEVTOOLS_OPEN' });

      expect(first.id).not.toBe(second.id);
      expect(second.id).not.toBe(third.id);
      expect(mockSets).toHaveLength(3);
      for (const set of mockSets) {
        expect(set).toHaveBeenCalledTimes(1);
      }
    });

    it('MonitorService exposes no update/patch/delete/remove methods', () => {
      const methods = Object.getOwnPropertyNames(MonitorService.prototype).filter((m) => m !== 'constructor');

      expect(methods.length).toBeGreaterThan(0);
      for (const method of methods) {
        expect(method).not.toMatch(/^(update|patch|delete|remove|modify|set|upsert|edit)/i);
      }
      // It must still have create + read methods
      expect(methods).toContain('createFlag');
      expect(methods).toContain('getFlagsBySubmission');
    });
  });

  describe('Rule 1: flag type enum', () => {
    it('is exactly the four values from the spec', () => {
      expect(Object.values(MONITOR_FLAG_TYPES).sort()).toEqual(
        ['DEVTOOLS_OPEN', 'FULLSCREEN_EXIT', 'PASTE_ATTEMPT', 'TAB_SWITCH'].sort()
      );
      expect(Object.keys(MONITOR_FLAG_TYPES)).toHaveLength(4);
    });
  });
});
