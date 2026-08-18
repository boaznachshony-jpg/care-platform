import { describe, expect, it } from 'vitest';
import { apiErrorSchema } from './api-error.js';

describe('apiErrorSchema', () => {
  it('accepts a well-formed error envelope', () => {
    const result = apiErrorSchema.safeParse({
      code: 'VALIDATION_ERROR',
      message: 'Unable to complete the request',
      fieldErrors: { email: ['Required'] },
      correlationId: 'corr-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing correlationId', () => {
    const result = apiErrorSchema.safeParse({
      code: 'VALIDATION_ERROR',
      message: 'Unable to complete the request',
    });
    expect(result.success).toBe(false);
  });
});
