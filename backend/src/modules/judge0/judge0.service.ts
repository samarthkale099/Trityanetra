import { submitCodeWithBreaker } from './judge0.circuitBreaker';

export const runCodeService = async (code: string, languageId: number) => {
  return await submitCodeWithBreaker(code, languageId);
};
