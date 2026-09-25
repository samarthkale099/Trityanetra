import axios from 'axios';
import { Judge0Client, Judge0ValidationError } from './client';
import { JUDGE0_BOUNDS } from '../../config/constants';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Judge0Client', () => {
  let client: Judge0Client;
  let mockAxiosInstance: any;

  beforeEach(() => {
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
    client = new Judge0Client();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy path', () => {
    it('should submit code and return token', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { token: 'abc-123' } });

      const result = await client.submit({
        source_code: 'print("hello")',
        language_id: 71,
      });

      expect(result).toEqual({ token: 'abc-123' });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/submissions', {
        source_code: 'print("hello")',
        language_id: 71,
      });
    });

    it('should get result by token', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          token: 'abc-123',
          stdout: 'hello\n',
          stderr: null,
          compile_output: null,
          status: { id: 3, description: 'Accepted' },
          time: '0.01',
          memory: 1024,
        },
      });

      const result = await client.getResult('abc-123');

      expect(result.token).toBe('abc-123');
      expect(result.stdout).toBe('hello\n');
      expect(result.status).toEqual({ id: 3, description: 'Accepted' });
      expect(result.memory).toBe(1024);
    });

    it('should submit batch', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { token: 'batch-123' } });

      const result = await client.submitBatch([
        { source_code: 'code1', language_id: 71 },
        { source_code: 'code2', language_id: 71 },
      ]);

      expect(result.token).toBe('batch-123');
    });
  });

  describe('Error cases', () => {
    it('should throw Judge0ValidationError for missing token in response', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      await expect(
        client.submit({ source_code: 'code', language_id: 71 })
      ).rejects.toThrow(Judge0ValidationError);
    });

    it('should throw Judge0ValidationError for invalid status in result', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          token: 'abc-123',
          status: { id: 'invalid' }, // should be number
        },
      });

      await expect(client.getResult('abc-123')).rejects.toThrow(Judge0ValidationError);
    });

    it('should throw Judge0ValidationError for non-object result', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: null });

      await expect(client.getResult('abc-123')).rejects.toThrow(Judge0ValidationError);
    });

    it('should throw Judge0ValidationError for negative memory', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          token: 'abc-123',
          status: { id: 3, description: 'Accepted' },
          memory: -100,
        },
      });

      await expect(client.getResult('abc-123')).rejects.toThrow(Judge0ValidationError);
    });

    it('should throw Judge0ValidationError for missing token in batch result', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      await expect(
        client.submitBatch([{ source_code: 'code', language_id: 71 }])
      ).rejects.toThrow(Judge0ValidationError);
    });

    it('should handle network errors gracefully', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network Error'));

      await expect(
        client.submit({ source_code: 'code', language_id: 71 })
      ).rejects.toThrow('Network Error');
    });

    it('should handle 500 responses from Judge0', async () => {
      mockAxiosInstance.get.mockRejectedValue({
        response: { status: 500, data: { error: 'Internal Server Error' } },
      });

      await expect(client.getResult('abc-123')).rejects.toThrow();
    });
  });

  describe('Adversarial cases', () => {
    it('should validate that result with string status.id is rejected', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          token: 'abc-123',
          status: { id: 'three', description: 'Accepted' },
        },
      });

      await expect(client.getResult('abc-123')).rejects.toThrow(Judge0ValidationError);
    });

    it('should handle response with extra unexpected fields gracefully', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          token: 'abc-123',
          stdout: 'hello',
          stderr: null,
          compile_output: null,
          status: { id: 3, description: 'Accepted' },
          time: '0.01',
          memory: 1024,
          unexpectedField: 'should be ignored',
        },
      });

      const result = await client.getResult('abc-123');
      expect(result.token).toBe('abc-123');
    });
  });

  describe('Rule 5: output size bounds', () => {
    const baseResult = (stdout: any) => ({
      token: 'abc-123',
      stdout,
      stderr: null,
      compile_output: null,
      status: { id: 3, description: 'Accepted' },
      time: '0.01',
      memory: 1024,
    });

    it('should accept stdout of exactly MAX_OUTPUT_CHARS (at the boundary)', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: baseResult('x'.repeat(JUDGE0_BOUNDS.MAX_OUTPUT_CHARS)),
      });

      const result = await client.getResult('abc-123');
      expect(result.stdout).toHaveLength(JUDGE0_BOUNDS.MAX_OUTPUT_CHARS);
    });

    it('should reject stdout one character over MAX_OUTPUT_CHARS', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: baseResult('x'.repeat(JUDGE0_BOUNDS.MAX_OUTPUT_CHARS + 1)),
      });

      await expect(client.getResult('abc-123')).rejects.toThrow(Judge0ValidationError);
      await expect(client.getResult('abc-123')).rejects.toThrow('maximum output size');
    });

    it('should accept stdout under the maximum', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: baseResult('ok') });

      const result = await client.getResult('abc-123');
      expect(result.stdout).toBe('ok');
    });

    it('should reject oversized stderr', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          ...baseResult(null),
          stderr: 'e'.repeat(JUDGE0_BOUNDS.MAX_OUTPUT_CHARS + 1),
        },
      });

      await expect(client.getResult('abc-123')).rejects.toThrow(Judge0ValidationError);
    });

    it('should reject oversized compile_output', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          ...baseResult(null),
          compile_output: 'c'.repeat(JUDGE0_BOUNDS.MAX_OUTPUT_CHARS + 1),
        },
      });

      await expect(client.getResult('abc-123')).rejects.toThrow(Judge0ValidationError);
    });

    it('should reject non-string stdout', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: baseResult(12345) });

      await expect(client.getResult('abc-123')).rejects.toThrow(Judge0ValidationError);
    });
  });

  describe('Rule 5: HTTP client timeout', () => {
    it('should configure the HTTP client with JUDGE0_BOUNDS.HTTP_TIMEOUT_MS', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: JUDGE0_BOUNDS.HTTP_TIMEOUT_MS })
      );
    });
  });
});
